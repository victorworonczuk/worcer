const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

// Reglas de precio (confirmadas por Víctor, lista de precios julio 2026):
// - "precioListaComercial" = precio de lista sin IVA, sin descuentos por volumen (LISTA DE PRECIOS 07.26.xlsx).
// - Comercial = precioListaComercial tal cual.
// - 1ª = precioListaComercial + 21% IVA.
// - 3ª (solo inodoro corto Nápoles / inodoro largo Lyon) = 50% de precioListaComercial.
const IVA = 1.21;
const FACTOR_3ERA = 0.5;

function precioParaCalidad(precioComercial, calidad) {
  if (precioComercial == null) return null;
  if (calidad === 'comercial') return Math.round(precioComercial);
  if (calidad === '1era') return Math.round(precioComercial * IVA);
  if (calidad === '3era') return Math.round(precioComercial * FACTOR_3ERA);
  return null;
}

// Catálogo: línea, tipo_pieza, variante (o null), calidades disponibles, precio de lista comercial (sin IVA).
const CATALOGO = [
  { linea: 'Napoles', tipo_pieza: 'Inodoro corto', variante: null, calidades: ['1era', 'comercial', '3era'], precioListaComercial: 92906 },
  { linea: 'Napoles', tipo_pieza: 'Deposito de codo', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 92648.5 },
  { linea: 'Napoles', tipo_pieza: 'Lavatorio', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 64272 },
  { linea: 'Napoles', tipo_pieza: 'Columna', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 48101 },
  { linea: 'Napoles', tipo_pieza: 'Bidet', variante: '3 agujeros', calidades: ['1era', 'comercial'], precioListaComercial: 92597 },
  { linea: 'Napoles', tipo_pieza: 'Bidet', variante: 'Monocomando', calidades: ['1era', 'comercial'], precioListaComercial: 92597 },

  { linea: 'Lyon', tipo_pieza: 'Inodoro largo', variante: null, calidades: ['1era', 'comercial', '3era'], precioListaComercial: 109592 },
  { linea: 'Lyon', tipo_pieza: 'Deposito de apoyo', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 107532 },
  { linea: 'Lyon', tipo_pieza: 'Bidet', variante: '3 agujeros', calidades: ['1era', 'comercial'], precioListaComercial: 106502 },
  { linea: 'Lyon', tipo_pieza: 'Bidet', variante: 'Monocomando', calidades: ['1era', 'comercial'], precioListaComercial: 106502 },

  // Lira y Belmond NO tienen 3era calidad (confirmado por Víctor) — solo 1era y comercial.
  // Nota: la hoja "Condiciones de venta" marca julio como "SIN STOCK" para estos dos combos,
  // pero la hoja "Precios febreroMarzo" sí tiene precio julio — usamos ese. Verificar con Víctor
  // si realmente están disponibles para vender.
  { linea: 'Lira', tipo_pieza: 'Combo (inodoro largo + depósito)', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 185400 },
  { linea: 'Belmond', tipo_pieza: 'Combo (inodoro largo + depósito)', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 236900 },

  { linea: 'Bachas', tipo_pieza: 'Cancún', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 68392 },
];

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema_piezas.sql'), 'utf8');
  await client.query(schema);
  console.log('Tablas piezas / factura_items creadas/verificadas.\n');

  let insertadas = 0;
  let actualizadas = 0;
  for (const item of CATALOGO) {
    for (const calidad of item.calidades) {
      const precio = precioParaCalidad(item.precioListaComercial, calidad);
      const { rows } = await client.query(
        `insert into public.piezas (linea, tipo_pieza, variante, calidad, precio_ars, precio_actualizado)
         values ($1, $2, $3, $4, $5, now())
         on conflict (linea, tipo_pieza, variante, calidad)
         do update set precio_ars = excluded.precio_ars, precio_actualizado = now()
         returning (xmax = 0) as es_nueva`,
        [item.linea, item.tipo_pieza, item.variante || '', calidad, precio]
      );
      if (rows[0].es_nueva) insertadas += 1;
      else actualizadas += 1;
    }
  }
  console.log(`Piezas nuevas: ${insertadas} | precios actualizados en existentes: ${actualizadas}`);

  const { rows } = await client.query('select linea, tipo_pieza, variante, calidad, precio_ars from public.piezas order by linea, tipo_pieza, variante, calidad');
  console.log(`\nCatálogo total: ${rows.length} combinaciones`);
  rows.forEach((r) => console.log(` - ${r.linea} / ${r.tipo_pieza}${r.variante ? ' (' + r.variante + ')' : ''} / ${r.calidad} -> $${r.precio_ars}`));

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
