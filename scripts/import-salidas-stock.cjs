// Carga salidas_stock_export.json (generado por parse-salidas-stock.py) en
// `factura_items`, cruzando cada renglón contra la factura ya cargada (por
// Importar ventas o por el import histórico) usando empresa+tipo+número, y
// contra el catálogo de piezas usando línea+tipo+variante+calidad.
// Es idempotente: upsert por (factura_id, pieza_id), así que se puede volver
// a correr con el mismo archivo, o con archivos de rango de fechas más
// amplio, sin duplicar ni sumar de más.
//
// Uso:
//   python3 scripts/parse-salidas-stock.py "SalidasStocks Cerámica.xlsx" ...
//   node scripts/import-salidas-stock.cjs
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

async function main() {
  const jsonPath = path.join(__dirname, '..', 'salidas_stock_export.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('No existe salidas_stock_export.json — corré primero parse-salidas-stock.py con los archivos del sistema de facturación.');
    process.exit(1);
  }
  const registros = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Renglones en el archivo: ${registros.length}`);

  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  // Agrupar por (factura, pieza) antes de tocar la base: una factura puede
  // traer dos renglones del mismo producto (pasa en los datos reales), y así
  // el upsert de más abajo queda determinístico sin importar cuántas veces
  // se corra este script sobre el mismo archivo.
  const grupos = new Map();
  for (const r of registros) {
    const key = `${r.empresa}|${r.tipo_comprobante}|${r.numero_comprobante}|${r.linea}|${r.tipo_pieza}|${r.variante}|${r.calidad}`;
    const actual = grupos.get(key);
    if (actual) {
      actual.cantidad += r.cantidad;
      actual.precio_vta = r.precio_vta ?? actual.precio_vta;
    } else {
      grupos.set(key, { ...r });
    }
  }
  console.log(`Renglones agrupados por factura+pieza: ${grupos.size}`);

  let cargados = 0;
  let sinFactura = 0;
  let sinPieza = 0;
  const facturasSinMatch = new Set();

  for (const r of grupos.values()) {
    const { rows: facturaRows } = await client.query(
      `select id from public.facturas where empresa = $1 and tipo_comprobante = $2 and numero_comprobante = $3`,
      [r.empresa, r.tipo_comprobante, r.numero_comprobante]
    );
    if (facturaRows.length === 0) {
      sinFactura += 1;
      facturasSinMatch.add(`${r.empresa} ${r.tipo_comprobante} ${r.numero_comprobante}`);
      continue;
    }
    const facturaId = facturaRows[0].id;

    const { rows: piezaRows } = await client.query(
      `select id from public.piezas where linea = $1 and tipo_pieza = $2 and variante = $3 and calidad = $4`,
      [r.linea, r.tipo_pieza, r.variante, r.calidad]
    );
    if (piezaRows.length === 0) {
      sinPieza += 1;
      continue;
    }
    const piezaId = piezaRows[0].id;

    await client.query(
      `insert into public.factura_items (factura_id, pieza_id, cantidad, precio_unitario)
       values ($1, $2, $3, $4)
       on conflict (factura_id, pieza_id)
       do update set cantidad = excluded.cantidad, precio_unitario = excluded.precio_unitario`,
      [facturaId, piezaId, r.cantidad, r.precio_vta]
    );
    cargados += 1;
  }

  console.log(`Cargados en factura_items: ${cargados}`);
  console.log(`Sin factura correspondiente (todavía no importada por Importar ventas, o número no coincide): ${sinFactura}`);
  if (sinFactura > 0) {
    const ejemplos = [...facturasSinMatch].slice(0, 10);
    console.log(`  Ejemplos: ${ejemplos.join(', ')}${facturasSinMatch.size > 10 ? ` (+${facturasSinMatch.size - 10} más)` : ''}`);
  }
  console.log(`Sin pieza correspondiente en el catálogo (no debería pasar): ${sinPieza}`);

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
