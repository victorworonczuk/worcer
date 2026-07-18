const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local'), quiet: true });
const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

const COLUMNS = [
  'cuit', 'nombre', 'nombre_fantasia', 'provincia', 'localidad', 'domicilio',
  'origen', 'segmento', 'meses_sin_comprar', 'ultima_compra',
  'usd_total_2025_2026', 'ars_total_2025_2026', 'meses_compra_2025_2026',
  'lineas', 'telefono', 'whatsapp', 'email', 'web', 'rubro', 'descripcion',
  'confianza_dato', 'fuente',
];

async function main() {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'clientes_export.json'), 'utf8'));
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  await client.query('truncate table public.clientes restart identity');

  const batchSize = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = [];
    const placeholders = batch.map((row, rowIdx) => {
      const base = rowIdx * COLUMNS.length;
      COLUMNS.forEach((col) => values.push(row[col] ?? null));
      const ph = COLUMNS.map((_, colIdx) => `$${base + colIdx + 1}`).join(', ');
      return `(${ph})`;
    }).join(', ');

    const sql = `insert into public.clientes (${COLUMNS.join(', ')}) values ${placeholders}`;
    await client.query(sql, values);
    inserted += batch.length;
    process.stdout.write(`\rInsertados: ${inserted}/${rows.length}`);
  }
  console.log('\nListo.');

  const { rows: countRows } = await client.query('select count(*) from public.clientes');
  console.log('Total en tabla:', countRows[0].count);

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
