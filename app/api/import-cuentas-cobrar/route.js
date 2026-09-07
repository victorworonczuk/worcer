import { NextResponse } from 'next/server';
import { Client } from 'pg';
import crypto from 'crypto';
import { parseCuentasCobrarXlsx } from '../../../lib/cuentasCobrarXlsx.js';
import { buscarClientePorNombre } from '../../../lib/clienteMatching.js';
import { resolverVendedor } from '../../../lib/vendedorMatching.js';

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

async function insertarPorLotes(client, tabla, columnas, columnasConflicto, filas) {
  const TAMANO_LOTE = 500;
  let nuevos = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    const valores = [];
    const placeholders = lote.map((fila, idx) => {
      const base = idx * columnas.length;
      columnas.forEach((c) => valores.push(fila[c] ?? null));
      return `(${columnas.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    const { rowCount } = await client.query(
      `insert into public.${tabla} (${columnas.join(', ')})
       values ${placeholders.join(', ')}
       on conflict (${columnasConflicto.join(', ')}) do nothing`,
      valores
    );
    nuevos += rowCount;
  }
  return nuevos;
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

  let cuentasCobrar = [];
  let chequesRechazados = [];
  try {
    for (const archivo of archivos) {
      const buffer = Buffer.from(await archivo.arrayBuffer());
      const parsed = await parseCuentasCobrarXlsx(buffer);
      cuentasCobrar = cuentasCobrar.concat(parsed.cuentasCobrar);
      chequesRechazados = chequesRechazados.concat(parsed.chequesRechazados);
    }
  } catch (err) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${err.message}` }, { status: 400 });
  }

  if (cuentasCobrar.length === 0 && chequesRechazados.length === 0) {
    return NextResponse.json({ error: 'No se encontraron filas reconocibles (¿tiene las hojas "2026", "Morosos" y/o "Cheques rechazados"?).' }, { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: clientesTodos } = await client.query('select id, nombre, vendedor from public.clientes');

    const clientesSinVincular = [];
    const vendedorAmbiguo = [];

    // El cliente matcheado y su vendedor fijo (cartera fija, ver
    // import-ventas/route.js) es más confiable que el nombre corto suelto de
    // esta planilla — solo se usa el nombre corto cuando no hay cliente
    // vinculado o el cliente todavía no tiene vendedor asignado.
    function resolverClienteYVendedor(nombreCliente, vendedorCrudo, contexto) {
      const { cliente, ambiguo } = buscarClientePorNombre(nombreCliente, clientesTodos);
      if (!cliente) {
        clientesSinVincular.push({ cliente_nombre: nombreCliente, ...contexto, ambiguo });
      }
      if (cliente && cliente.vendedor) {
        return { clienteId: cliente.id, vendedor: cliente.vendedor };
      }
      const { vendedor, ambiguo: vendedorEsAmbiguo } = resolverVendedor(vendedorCrudo);
      if (vendedorEsAmbiguo) {
        vendedorAmbiguo.push({ cliente_nombre: nombreCliente, ...contexto, vendedor_crudo: vendedorCrudo });
      }
      return { clienteId: cliente ? cliente.id : null, vendedor: vendedor || vendedorCrudo };
    }

    const cuentasParaCargar = cuentasCobrar.map((r) => {
      const { clienteId, vendedor } = resolverClienteYVendedor(r.cliente_nombre, r.vendedor_crudo, { empresa: r.empresa, numero_factura: r.numero_factura, monto: r.monto });
      return {
        empresa: r.empresa,
        fecha_emision: r.fecha_emision,
        numero_factura: r.numero_factura,
        cliente_nombre: r.cliente_nombre,
        cliente_id: clienteId,
        monto: r.monto,
        fecha_entrega: r.fecha_entrega,
        fecha_estimada_pago: r.fecha_estimada_pago,
        vendedor,
        origen: r.origen,
        cargado_por: 'import-cuentas-cobrar',
      };
    });

    const chequesParaCargar = chequesRechazados.map((r) => {
      const { clienteId, vendedor } = resolverClienteYVendedor(r.cliente_nombre, r.vendedor_crudo, { empresa: r.empresa, numero_factura: r.numero_nd, monto: r.monto_debido });
      return {
        empresa: r.empresa,
        fecha_nd: r.fecha_nd,
        numero_nd: r.numero_nd,
        cliente_nombre: r.cliente_nombre,
        cliente_id: clienteId,
        monto_debido: r.monto_debido,
        monto_recuperado: r.monto_recuperado,
        saldo: r.saldo,
        numero_cheque: r.numero_cheque,
        tipo_cheque: r.tipo_cheque,
        estado: r.estado,
        fecha_recupero: r.fecha_recupero,
        vendedor,
        cargado_por: 'import-cuentas-cobrar',
      };
    });

    const nuevosCuentas = await insertarPorLotes(
      client, 'cuentas_cobrar',
      ['empresa', 'fecha_emision', 'numero_factura', 'cliente_nombre', 'cliente_id', 'monto', 'fecha_entrega', 'fecha_estimada_pago', 'vendedor', 'origen', 'cargado_por'],
      ['empresa', 'numero_factura'],
      cuentasParaCargar
    );
    const nuevosCheques = await insertarPorLotes(
      client, 'cheques_rechazados',
      ['empresa', 'fecha_nd', 'numero_nd', 'cliente_nombre', 'cliente_id', 'monto_debido', 'monto_recuperado', 'saldo', 'numero_cheque', 'tipo_cheque', 'estado', 'fecha_recupero', 'vendedor', 'cargado_por'],
      ['empresa', 'numero_nd'],
      chequesParaCargar
    );

    return NextResponse.json({
      ok: true,
      cuentas_leidas: cuentasCobrar.length,
      cuentas_nuevas: nuevosCuentas,
      cheques_leidos: chequesRechazados.length,
      cheques_nuevos: nuevosCheques,
      clientes_sin_vincular: clientesSinVincular.slice(0, 60),
      clientes_sin_vincular_total: clientesSinVincular.length,
      vendedor_ambiguo: vendedorAmbiguo.slice(0, 30),
      vendedor_ambiguo_total: vendedorAmbiguo.length,
    });
  } finally {
    await client.end();
  }
}
