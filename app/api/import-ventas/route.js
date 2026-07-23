import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseVentasXml, mesDe } from '../../../lib/ventasXml.js';
import { buscarClienteSinCuitPorNombre } from '../../../lib/clienteMatching.js';

// CUITs de las propias sociedades de Worcer (Cerámica Sanitaria 8 de Julio SRL,
// Porcelanas Alberti SRL) — a veces se facturan cosas entre ellas mismas
// (operación intercompañía), y esas facturas no son ventas a un cliente real.
// Sin esta lista, el alta automática las tomaría como un cliente nuevo (pasó:
// ver commit "Dar de alta clientes automáticamente al importar ventas").
const CUITS_PROPIOS = new Set(['30709413208', '30714033189']);

// Otros CUITs "genéricos" de consumidor final detectados manualmente, que no
// matchean el patrón de dígito repetido (ver caso "Santiago Delia" mezclado
// con "Jose Peralta" bajo 10-00000000-1) pero funcionan igual de mal: agrupan
// compradores distintos bajo un mismo número. Agregar acá cualquier otro caso
// que aparezca en el futuro.
const CUITS_GENERICOS = new Set(['10000000001']);

function getSessionUser(request) {
  const cookie = request.cookies.get('worcer_auth');
  if (!cookie) return null;
  const parts = cookie.value.split(':');
  if (parts.length !== 3) return null;
  const [username, exp, sig] = parts;
  if (Date.now() > Number(exp)) return null;
  const payload = `${username}:${exp}`;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  return expected === sig ? username : null;
}

export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const formData = await request.formData();
  const archivos = formData.getAll('archivos');
  if (!archivos.length) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  let registros = [];
  try {
    for (const archivo of archivos) {
      const texto = await archivo.text();
      registros = registros.concat(parseVentasXml(texto, archivo.name));
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let nuevos = 0;
  let existentes = 0;
  try {
    for (const r of registros) {
      const { rowCount } = await client.query(
        `insert into public.facturas
           (cuit_normalizado, cuit_original, nombre_facturado, empresa, fecha, mes,
            tipo_comprobante, numero_comprobante, importe_ars, cargado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import-ventas')
         on conflict (empresa, tipo_comprobante, numero_comprobante) do nothing`,
        [
          r.cuit_normalizado, r.cuit_original, r.nombre_facturado, r.empresa, r.fecha,
          mesDe(r.fecha), r.tipo_comprobante, r.numero_comprobante, r.importe_ars,
        ]
      );
      if (rowCount > 0) nuevos += 1; else existentes += 1;
    }

    // Ningún cliente debería tener un CUIT genérico cargado como si fuera el
    // propio (pasó con "Santiago Delia" y 10-00000000-1, mezclándolo con
    // "Jose Peralta") — se excluyen acá también para que ese blind-match por
    // CUIT no lo vuelva a hacer si el campo cuit de algún cliente queda mal
    // cargado en el futuro.
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

    // Alta automática: solo para CUITs reales con un único nombre asociado.
    // CUITs de un solo dígito repetido (00000000000, 11111111111, ...) son
    // los que el sistema de facturación usa para "consumidor final"/ventas sin
    // identificación real — bajo ese mismo CUIT aparecen decenas de personas
    // distintas, así que crear un cliente ahí mezclaría gente que no tiene
    // nada que ver. También se exige un único nombre_facturado en toda la
    // tabla como resguardo extra, no solo el patrón de dígito repetido.
    // CUITS_GENERICOS suma casos detectados a mano que no son dígito repetido
    // pero cumplen la misma función de "consumidor final" (ver comentario arriba).
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
    // el CUIT en ese cliente existente en vez de crear un duplicado. Sin esto,
    // apenas un lead sin CUIT compra de verdad, quedaba con dos registros.
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

    // El vendedor de un cliente es fijo (cartera fija, confirmado con
    // Víctor) — si el cliente ya tiene uno asignado, se copia directo a la
    // factura recién vinculada, sin necesitar el cruce por importe de
    // /cotejar-vendedores.html.
    const { rowCount: vendedorAsignado } = await client.query(`
      update public.facturas f
      set vendedor = c.vendedor, vendedor_fuente = 'cliente_asignado'
      from public.clientes c
      where f.cliente_id = c.id and f.vendedor is null and c.vendedor is not null
    `);

    const { rows: sinVincular } = await client.query(`
      select nombre_facturado, cuit_original, empresa, importe_ars
      from public.facturas
      where cliente_id is null and cargado_por = 'import-ventas'
      order by created_at desc limit 20
    `);

    return NextResponse.json({
      ok: true,
      leidos: registros.length,
      nuevos,
      existentes,
      vinculadas,
      altas_automaticas: altasAutomaticas,
      vinculadas_por_nombre: vinculadasPorNombre,
      vendedor_asignado_por_cliente: vendedorAsignado,
      sin_vincular: sinVincular,
    });
  } finally {
    await client.end();
  }
}
