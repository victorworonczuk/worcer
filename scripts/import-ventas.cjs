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

async function main() {
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

  const { rowCount: vinculadas } = await client.query(`
    update public.facturas f
    set cliente_id = c.id
    from public.clientes c
    where f.cliente_id is null
      and f.cuit_normalizado is not null
      and regexp_replace(c.cuit, '[^0-9]', '', 'g') = f.cuit_normalizado
  `);
  console.log(`Facturas recién vinculadas a un cliente existente: ${vinculadas}`);

  // Alta automática: solo para CUITs reales con un único nombre asociado (ver
  // nota en README sobre por qué se excluyen los de dígito repetido y los
  // propios de Worcer).
  const { rows: candidatos } = await client.query(`
    select cuit_normalizado, min(cuit_original) as cuit_original, min(nombre_facturado) as nombre_facturado
    from public.facturas
    where cliente_id is null
      and cuit_normalizado is not null
      and cuit_normalizado !~ '^(\\d)\\1*$'
    group by cuit_normalizado
    having count(distinct nombre_facturado) = 1
  `);
  let altasAutomaticas = 0;
  for (const c of candidatos) {
    if (CUITS_PROPIOS.has(c.cuit_normalizado)) continue;
    const { rows: nuevoCliente } = await client.query(
      `insert into public.clientes (nombre, cuit, origen, confianza_dato, estado_contacto)
       values ($1, $2, 'Alta automática (import ventas)', 'alta', 'pendiente')
       returning id`,
      [c.nombre_facturado, c.cuit_original]
    );
    await client.query(
      `update public.facturas set cliente_id = $1 where cuit_normalizado = $2 and cliente_id is null`,
      [nuevoCliente[0].id, c.cuit_normalizado]
    );
    altasAutomaticas += 1;
  }
  console.log(`Clientes nuevos dados de alta automáticamente: ${altasAutomaticas}`);

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
