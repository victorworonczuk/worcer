const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

const key = (linea, tipo_pieza, variante, calidad) =>
  `${linea}|${tipo_pieza}|${variante || ''}|${calidad}`;

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  // 1) Crear/verificar la tabla produccion.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema_produccion.sql'), 'utf8');
  await client.query(schema);
  console.log('Tabla produccion creada/verificada.');

  // 2) Catálogo de piezas -> id. (Correr antes: node scripts/setup-piezas.cjs)
  const { rows: piezas } = await client.query(
    'select id, linea, tipo_pieza, variante, calidad from public.piezas'
  );
  const piezaId = new Map();
  piezas.forEach((p) => piezaId.set(key(p.linea, p.tipo_pieza, p.variante, p.calidad), p.id));
  console.log(`Catálogo cargado: ${piezas.length} piezas.`);

  // 3) Solo se borra el import histórico anterior (cargado_por is null); lo que
  //    carguen los operarios desde /produccion-carga.html se conserva.
  const { rowCount: borradas } = await client.query(
    'delete from public.produccion where cargado_por is null'
  );
  console.log(`Import histórico anterior borrado: ${borradas} filas (se conservó la carga manual).`);

  // 4) Leer el export y resolver pieza_id. Se agregan por (fecha,pieza_id,tipo)
  //    para respetar el unique de la tabla ante cualquier duplicado del export.
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'produccion_export.json'), 'utf8'));
  const agg = new Map();
  const sinMapear = new Map();
  for (const r of rows) {
    const id = piezaId.get(key(r.linea, r.tipo_pieza, r.variante, r.calidad));
    if (!id) {
      const k = key(r.linea, r.tipo_pieza, r.variante, r.calidad);
      sinMapear.set(k, (sinMapear.get(k) || 0) + r.cantidad);
      continue;
    }
    const k = `${r.fecha}|${id}|${r.tipo}`;
    agg.set(k, (agg.get(k) || 0) + r.cantidad);
  }

  if (sinMapear.size) {
    console.warn('\n[ATENCIÓN] Piezas del export que no existen en el catálogo (no se importan):');
    for (const [k, cant] of sinMapear) console.warn(`   ${k}  (cantidad total: ${cant})`);
    console.warn('   -> Correr primero `node scripts/setup-piezas.cjs` para crearlas.\n');
  }

  // 5) Insertar en lotes.
  const entries = [...agg.entries()].map(([k, cantidad]) => {
    const [fecha, id, tipo] = k.split('|');
    return [fecha, Number(id), tipo, cantidad];
  });
  const batchSize = 200;
  let inserted = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const values = [];
    const placeholders = batch.map((row, idx) => {
      const b = idx * 5;
      values.push(row[0], row[1], row[2], row[3], null); // fecha, pieza_id, tipo, cantidad, cargado_por(null=histórico)
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    }).join(', ');
    await client.query(
      `insert into public.produccion (fecha, pieza_id, tipo, cantidad, cargado_por)
       values ${placeholders}
       on conflict (fecha, pieza_id, tipo) do update set cantidad = excluded.cantidad`,
      values
    );
    inserted += batch.length;
    process.stdout.write(`\rInsertadas: ${inserted}/${entries.length}`);
  }
  console.log('');

  // 6) Control de totales.
  const { rows: tot } = await client.query(
    `select tipo, sum(cantidad)::int as total from public.produccion group by tipo order by tipo`
  );
  console.log('Totales cargados por tipo:');
  tot.forEach((t) => console.log(`   ${t.tipo}: ${t.total}`));
  console.log('(esperado: produccion 10345 | venta 9239 | rotura 314)');

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
