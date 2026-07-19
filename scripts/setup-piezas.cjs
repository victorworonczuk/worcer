const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

// Catálogo: línea, tipo_pieza, variante (o null), calidades disponibles.
const CATALOGO = [
  { linea: 'Napoles', tipo_pieza: 'Inodoro corto', variante: null, calidades: ['1era', 'comercial', '3era'] },
  { linea: 'Napoles', tipo_pieza: 'Deposito de codo', variante: null, calidades: ['1era', 'comercial'] },
  { linea: 'Napoles', tipo_pieza: 'Lavatorio', variante: null, calidades: ['1era', 'comercial'] },
  { linea: 'Napoles', tipo_pieza: 'Columna', variante: null, calidades: ['1era', 'comercial'] },
  { linea: 'Napoles', tipo_pieza: 'Bidet', variante: '3 agujeros', calidades: ['1era', 'comercial'] },
  { linea: 'Napoles', tipo_pieza: 'Bidet', variante: 'Monocomando', calidades: ['1era', 'comercial'] },

  { linea: 'Lyon', tipo_pieza: 'Inodoro largo', variante: null, calidades: ['1era', 'comercial', '3era'] },
  { linea: 'Lyon', tipo_pieza: 'Deposito de apoyo', variante: null, calidades: ['1era', 'comercial'] },
  { linea: 'Lyon', tipo_pieza: 'Bidet', variante: '3 agujeros', calidades: ['1era', 'comercial'] },
  { linea: 'Lyon', tipo_pieza: 'Bidet', variante: 'Monocomando', calidades: ['1era', 'comercial'] },

  // Lira y Belmond NO tienen 3era calidad (confirmado por Víctor) — solo 1era y comercial.
  { linea: 'Lira', tipo_pieza: 'Combo (inodoro largo + depósito)', variante: null, calidades: ['1era', 'comercial'] },
  { linea: 'Belmond', tipo_pieza: 'Combo (inodoro largo + depósito)', variante: null, calidades: ['1era', 'comercial'] },
];

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema_piezas.sql'), 'utf8');
  await client.query(schema);
  console.log('Tablas piezas / factura_items creadas/verificadas.\n');

  let insertadas = 0;
  let existentes = 0;
  for (const item of CATALOGO) {
    for (const calidad of item.calidades) {
      const { rowCount } = await client.query(
        `insert into public.piezas (linea, tipo_pieza, variante, calidad)
         values ($1, $2, $3, $4)
         on conflict (linea, tipo_pieza, variante, calidad) do nothing`,
        [item.linea, item.tipo_pieza, item.variante, calidad]
      );
      if (rowCount > 0) insertadas += 1;
      else existentes += 1;
    }
  }
  console.log(`Piezas nuevas insertadas: ${insertadas} | ya existentes: ${existentes}`);

  const { rows } = await client.query('select linea, tipo_pieza, variante, calidad from public.piezas order by linea, tipo_pieza, variante, calidad');
  console.log(`\nCatálogo total: ${rows.length} combinaciones`);
  rows.forEach((r) => console.log(` - ${r.linea} / ${r.tipo_pieza}${r.variante ? ' (' + r.variante + ')' : ''} / ${r.calidad}`));

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
