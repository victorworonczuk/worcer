import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseComprasProveedorXlsx } from '../../../lib/comprasProveedorXlsx.js';
import { buscarClientePorNombre, normalizarNombre } from '../../../lib/clienteMatching.js';

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
  const archivo = formData.get('archivo');
  if (!archivo) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    parsed = await parseComprasProveedorXlsx(buffer);
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${err.message}` }, { status: 400 });
  }

  if (parsed.registros.length === 0) {
    return NextResponse.json({ error: 'No se encontraron filas de compra reconocibles (Estado="OK", con F.Compra y proveedor cargados).' }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: proveedoresTodos } = await client.query('select id, nombre from public.proveedores');
    // key = nombre normalizado -> id, para no dar de alta el mismo proveedor
    // dos veces dentro de esta misma importación (ej. "Hernan Silva" aparece
    // muchas filas seguidas).
    const cacheProveedorId = new Map(proveedoresTodos.map((p) => [normalizarNombre(p.nombre), p.id]));

    let proveedoresNuevos = 0;
    const comprasParaCargar = [];
    for (const r of parsed.registros) {
      const key = normalizarNombre(r.proveedor);
      let proveedorId = cacheProveedorId.get(key);
      if (proveedorId === undefined) {
        const { cliente } = buscarClientePorNombre(r.proveedor, proveedoresTodos);
        if (cliente) {
          proveedorId = cliente.id;
        } else {
          const { rows } = await client.query(
            'insert into public.proveedores (nombre, cargado_por) values ($1, $2) returning id',
            [r.proveedor, 'import-compras-proveedor']
          );
          proveedorId = rows[0].id;
          proveedoresNuevos += 1;
        }
        cacheProveedorId.set(key, proveedorId);
      }

      const descripcionFinal = r.cantidad ? `${r.cantidad} x ${r.descripcion}` : r.descripcion;
      comprasParaCargar.push({
        proveedor_id: proveedorId,
        fecha: r.fecha,
        cantidad: r.cantidad,
        descripcion: descripcionFinal,
        monto: r.monto,
        cargado_por: 'import-compras-proveedor',
      });
    }

    const columnas = ['proveedor_id', 'fecha', 'cantidad', 'descripcion', 'monto', 'cargado_por'];
    let nuevas = 0;
    const TAMANO_LOTE = 500;
    for (let i = 0; i < comprasParaCargar.length; i += TAMANO_LOTE) {
      const lote = comprasParaCargar.slice(i, i + TAMANO_LOTE);
      const valores = [];
      const placeholders = lote.map((fila, idx) => {
        const base = idx * columnas.length;
        columnas.forEach((c) => valores.push(fila[c] ?? null));
        return `(${columnas.map((_, j) => `$${base + j + 1}`).join(', ')})`;
      });
      const { rowCount } = await client.query(
        `insert into public.compras_proveedor (${columnas.join(', ')})
         values ${placeholders.join(', ')}
         on conflict (proveedor_id, fecha, descripcion, monto) do nothing`,
        valores
      );
      nuevas += rowCount;
    }

    return NextResponse.json({
      ok: true,
      leidas: parsed.registros.length,
      nuevas,
      existentes: parsed.registros.length - nuevas,
      proveedores_nuevos: proveedoresNuevos,
      no_aprobadas: parsed.noAprobadas,
      sin_f_compra: parsed.sinFCompra,
      sin_proveedor: parsed.sinProveedor,
    });
  } finally {
    await client.end();
  }
}
