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
  'cuit_normalizado', 'cuit_original', 'nombre_facturado', 'empresa', 'fecha',
  'mes', 'tipo_comprobante', 'numero_comprobante', 'importe_ars', 'tipo_cambio', 'importe_usd',
];

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema_facturas.sql'), 'utf8');
  await client.query(schema);
  console.log('Tabla facturas creada/verificada.');

  await client.query('truncate table public.facturas restart identity');

  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'facturas_export.json'), 'utf8'));
  const batchSize = 200;
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
    await client.query(`insert into public.facturas (${COLUMNS.join(', ')}) values ${placeholders}`, values);
    inserted += batch.length;
    process.stdout.write(`\rInsertadas: ${inserted}/${rows.length}`);
  }
  console.log('\nVinculando facturas con clientes por CUIT...');

  const { rowCount } = await client.query(`
    update public.facturas f
    set cliente_id = c.id
    from public.clientes c
    where f.cliente_id is null
      and f.cuit_normalizado is not null
      and regexp_replace(c.cuit, '[^0-9]', '', 'g') = f.cuit_normalizado
  `);
  console.log('Facturas vinculadas a un cliente existente:', rowCount);

  const { rows: totalRows } = await client.query('select count(*) from public.facturas');
  const { rows: linkedRows } = await client.query('select count(*) from public.facturas where cliente_id is not null');
  console.log('Total facturas:', totalRows[0].count, '| con cliente vinculado:', linkedRows[0].count);

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
