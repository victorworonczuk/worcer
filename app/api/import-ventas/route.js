import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseVentasXml, mesDe } from '../../../lib/ventasXml.js';

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
      sin_vincular: sinVincular,
    });
  } finally {
    await client.end();
  }
}
