// Carga ventas_export.json (generado por parse-ventas-xml.py) en `facturas`.
// Es idempotente: si un comprobante ya existe (mismo empresa + tipo + número),
// se lo salta en vez de duplicarlo — así se puede volver a correr con el mismo
// archivo, o con archivos de meses que se superponen, sin miedo.
//
// Uso:
//   python3 scripts/parse-ventas-xml.py "Ventas Cerámica Junio 2026.xml" ...
//   node scripts/import-ventas.cjs
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function mesDe(fechaIso) {
  return MESES[Number(fechaIso.slice(5, 7)) - 1];
}

// CUITs de las propias sociedades de Worcer (Cerámica Sanitaria 8 de Julio SRL,
// Porcelanas Alberti SRL) — a veces se facturan cosas entre ellas mismas
// (operación intercompañía), y esas facturas no son ventas a un cliente real.
const CUITS_PROPIOS = new Set(['30709413208', '30714033189']);

// Otros CUITs "genéricos" de consumidor final detectados manualmente, que no
// matchean el patrón de dígito repetido (ver caso "Santiago Delia" mezclado
// con "Jose Peralta" bajo 10-00000000-1) pero funcionan igual de mal: agrupan
// compradores distintos bajo un mismo número. Agregar acá cualquier otro caso
// que aparezca en el futuro. Debe estar sincronizado con
// app/api/import-ventas/route.js.
const CUITS_GENERICOS = new Set(['10000000001']);

async function main() {
  const { buscarClienteSinCuitPorNombre } = await import('../lib/clienteMatching.js');

  const jsonPath = path.join(__dirname, '..', 'ventas_export.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('No existe ventas_export.json — corré primero parse-ventas-xml.py con los archivos del sistema de facturación.');
    process.exit(1);
  }
  const registros = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Comprobantes en el archivo: ${registros.length}`);

  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  let nuevos = 0;
  let existentes = 0;
  for (const r of registros) {
    const { rowCount } = await client.query(
      `insert into public.facturas
         (cuit_normalizado, cuit_original, nombre_facturado, empresa, fecha, mes,
          tipo_comprobante, numero_comprobante, importe_ars, cargado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import-ventas')
       on conflict (empresa, tipo_comprobante, numero_comprobante) do nothing`,
      [
        r.cuit_normalizado, r.cuit_original, r.nombre_facturado, r.empresa, r.fecha,
        mesDe(r.fecha), r.tipo_comprobante || null, r.numero_comprobante, r.importe_ars,
      ]
    );
    if (rowCount > 0) nuevos += 1; else existentes += 1;
  }
  console.log(`Comprobantes nuevos insertados: ${nuevos}`);
  console.log(`Ya existían (se saltearon): ${existentes}`);

  const cuitsGenericosArr = [...CUITS_GENERICOS];
  const { rowCount: vinculadas } = await client.query(`
    update public.facturas f
    set cliente_id = c.id
    from public.clientes c
    where f.cliente_id is null
      and f.cuit_normalizado is not null
      and regexp_replace(c.cuit, '[^0-9]', '', 'g') = f.cuit_normalizado
      and f.cuit_normalizado !~ '^(\\d)\\1*$'
      and not (f.cuit_normalizado = any($1::text[]))
  `, [cuitsGenericosArr]);
  console.log(`Facturas recién vinculadas a un cliente existente: ${vinculadas}`);

  // Alta automática: solo para CUITs reales con un único nombre asociado (ver
  // nota en README sobre por qué se excluyen los de dígito repetido y los
  // propios de Worcer). CUITS_GENERICOS suma casos detectados a mano que no
  // son dígito repetido pero cumplen la misma función de "consumidor final".
  const { rows: candidatos } = await client.query(`
    select cuit_normalizado, min(cuit_original) as cuit_original, min(nombre_facturado) as nombre_facturado
    from public.facturas
    where cliente_id is null
      and cuit_normalizado is not null
      and cuit_normalizado !~ '^(\\d)\\1*$'
      and not (cuit_normalizado = any($1::text[]))
    group by cuit_normalizado
    having count(distinct nombre_facturado) = 1
  `, [cuitsGenericosArr]);
  // Antes de dar de alta un cliente nuevo, se intenta primero contra los
  // clientes sin CUIT cargado (leads del import de Llamados, altas manuales
  // sin CUIT, etc.) — si el nombre matchea con fuerza razonable, se completa
  // el CUIT en ese cliente existente en vez de crear un duplicado.
  const { rows: clientesSinCuit } = await client.query(
    `select id, nombre from public.clientes where cuit is null`
  );

  let altasAutomaticas = 0;
  let vinculadasPorNombre = 0;
  for (const c of candidatos) {
    if (CUITS_PROPIOS.has(c.cuit_normalizado)) continue;

    const matchPorNombre = buscarClienteSinCuitPorNombre(c.nombre_facturado, clientesSinCuit);
    let clienteId;
    if (matchPorNombre) {
      await client.query(`update public.clientes set cuit = $1 where id = $2`, [c.cuit_original, matchPorNombre.id]);
      clienteId = matchPorNombre.id;
      clientesSinCuit.splice(clientesSinCuit.indexOf(matchPorNombre), 1);
      vinculadasPorNombre += 1;
    } else {
      const { rows: nuevoCliente } = await client.query(
        `insert into public.clientes (nombre, cuit, origen, confianza_dato, estado_contacto)
         values ($1, $2, 'Alta automática (import ventas)', 'alta', 'pendiente')
         returning id`,
        [c.nombre_facturado, c.cuit_original]
      );
      clienteId = nuevoCliente[0].id;
      altasAutomaticas += 1;
    }
    await client.query(
      `update public.facturas set cliente_id = $1 where cuit_normalizado = $2 and cliente_id is null`,
      [clienteId, c.cuit_normalizado]
    );
  }
  console.log(`Clientes nuevos dados de alta automáticamente: ${altasAutomaticas}`);
  console.log(`Completados con CUIT por coincidir con un cliente sin CUIT ya cargado: ${vinculadasPorNombre}`);

  // El vendedor de un cliente es fijo (cartera fija, confirmado con Víctor) —
  // si el cliente ya tiene uno asignado, se copia directo a la factura recién
  // vinculada, sin necesitar el cruce por importe de /cotejar-vendedores.html.
  const { rowCount: vendedorAsignado } = await client.query(`
    update public.facturas f
    set vendedor = c.vendedor, vendedor_fuente = 'cliente_asignado'
    from public.clientes c
    where f.cliente_id = c.id and f.vendedor is null and c.vendedor is not null
  `);
  console.log(`Facturas con vendedor asignado por el vendedor fijo del cliente: ${vendedorAsignado}`);

  const { rows: sinVincular } = await client.query(`
    select count(*) from public.facturas
    where cliente_id is null and cargado_por = 'import-ventas'
  `);
  console.log(`Facturas de este import sin cliente encontrado (CUIT no está en la base): ${sinVincular[0].count}`);

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
