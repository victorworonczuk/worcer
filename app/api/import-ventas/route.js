import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseVentasXml, mesDe } from '../../../lib/ventasXml.js';

// CUITs de las propias sociedades de Worcer (Cerámica Sanitaria 8 de Julio SRL,
// Porcelanas Alberti SRL) — a veces se facturan cosas entre ellas mismas
// (operación intercompañía), y esas facturas no son ventas a un cliente real.
// Sin esta lista, el alta automática las tomaría como un cliente nuevo (pasó:
// ver commit "Dar de alta clientes automáticamente al importar ventas").
const CUITS_PROPIOS = new Set(['30709413208', '30714033189']);

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

    const { rowCount: vinculadas } = await client.query(`
      update public.facturas f
      set cliente_id = c.id
      from public.clientes c
      where f.cliente_id is null
        and f.cuit_normalizado is not null
        and regexp_replace(c.cuit, '[^0-9]', '', 'g') = f.cuit_normalizado
    `);

    // Alta automática: solo para CUITs reales con un único nombre asociado.
    // CUITs de un solo dígito repetido (00000000000, 11111111111, ...) son
    // los que el sistema de facturación usa para "consumidor final"/ventas sin
    // identificación real — bajo ese mismo CUIT aparecen decenas de personas
    // distintas, así que crear un cliente ahí mezclaría gente que no tiene
    // nada que ver. También se exige un único nombre_facturado en toda la
    // tabla como resguardo extra, no solo el patrón de dígito repetido.
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
      sin_vincular: sinVincular,
    });
  } finally {
    await client.end();
  }
}
