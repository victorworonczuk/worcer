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

function precioParaCalidad(precioComercial, calidad, tercera_sin_precio) {
  if (precioComercial == null) return null;
  if (calidad === 'comercial') return Math.round(precioComercial);
  if (calidad === '1era') return Math.round(precioComercial * IVA);
  if (calidad === '3era') {
    // La regla del 50% está confirmada solo para inodoro corto/largo. Para el
    // resto de las piezas la fábrica sí produce 3ª calidad (ver módulo producción),
    // pero su precio de venta no está definido -> se deja en blanco (null) hasta
    // que Víctor lo confirme, para no inventar un precio de venta.
    if (tercera_sin_precio) return null;
    return Math.round(precioComercial * FACTOR_3ERA);
  }
  return null;
}

// Catálogo: línea, tipo_pieza, variante (o null), calidades disponibles, precio de lista comercial (sin IVA).
// Nota: las calidades '3era' agregadas a Bidet / Lavatorio / Columna existen porque
// la fábrica produce 3ª de esas piezas (histórico 2026). Van con `tercera_sin_precio: true`
// -> se insertan en el catálogo con precio null (venta a definir), pero permiten que el
// módulo producción resuelva su pieza_id.
const CATALOGO = [
  { linea: 'Napoles', tipo_pieza: 'Inodoro corto', variante: null, calidades: ['1era', 'comercial', '3era'], precioListaComercial: 92906 },
  { linea: 'Napoles', tipo_pieza: 'Deposito de codo', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 92648.5 },
  { linea: 'Napoles', tipo_pieza: 'Lavatorio', variante: null, calidades: ['1era', 'comercial', '3era'], precioListaComercial: 64272, tercera_sin_precio: true },
  { linea: 'Napoles', tipo_pieza: 'Lavatorio', variante: 'Monocomando', calidades: ['1era', 'comercial'], precioListaComercial: 64272 }, // NUEVO (19/07). Precio = mismo que lavatorio base, confirmar con Víctor.
  { linea: 'Napoles', tipo_pieza: 'Columna', variante: null, calidades: ['1era', 'comercial', '3era'], precioListaComercial: 48101, tercera_sin_precio: true },
  { linea: 'Napoles', tipo_pieza: 'Bidet', variante: '3 agujeros', calidades: ['1era', 'comercial', '3era'], precioListaComercial: 92597, tercera_sin_precio: true },
  { linea: 'Napoles', tipo_pieza: 'Bidet', variante: 'Monocomando', calidades: ['1era', 'comercial'], precioListaComercial: 92597 },

  { linea: 'Lyon', tipo_pieza: 'Inodoro largo', variante: null, calidades: ['1era', 'comercial', '3era'], precioListaComercial: 109592 },
  { linea: 'Lyon', tipo_pieza: 'Deposito de apoyo', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 107532 },
  { linea: 'Lyon', tipo_pieza: 'Bidet', variante: '3 agujeros', calidades: ['1era', 'comercial', '3era'], precioListaComercial: 106502, tercera_sin_precio: true },
  { linea: 'Lyon', tipo_pieza: 'Bidet', variante: 'Monocomando', calidades: ['1era', 'comercial', '3era'], precioListaComercial: 106502, tercera_sin_precio: true },

  // Lira y Belmond NO tienen 3era calidad (confirmado por Víctor) — solo 1era y comercial.
  // Nota: la hoja "Condiciones de venta" marca julio como "SIN STOCK" para estos dos combos,
  // pero la hoja "Precios febreroMarzo" sí tiene precio julio — usamos ese. Verificar con Víctor
  // si realmente están disponibles para vender.
  { linea: 'Lira', tipo_pieza: 'Combo (inodoro largo + depósito)', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 185400 },
  { linea: 'Belmond', tipo_pieza: 'Combo (inodoro largo + depósito)', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 236900 },

  { linea: 'Bachas', tipo_pieza: 'Cancún', variante: null, calidades: ['1era', 'comercial'], precioListaComercial: 68392 },
];

// Repuestos/accesorios y piezas sueltas fuera de catálogo, detectados en los
// reportes de "Salidas de Stocks" del sistema de facturación (códigos 04xx y
// 999) — no están en LISTA DE PRECIOS, así que no tienen la distinción
// 1era/comercial/3era con IVA: se cargan con una única calidad ('comercial')
// y el precio de venta observado en esos mismos reportes (no se les aplica
// el +21% IVA de precioParaCalidad, sería inventar un precio que no vimos).
const CATALOGO_REPUESTOS = [
  { linea: 'Repuestos', tipo_pieza: 'Elemento de mochila', variante: '', precio_ars: 21000 },
  { linea: 'Repuestos', tipo_pieza: 'Tapa de mochila', variante: '', precio_ars: 25400 },
  { linea: 'Repuestos', tipo_pieza: 'Tapa de inodoro', variante: 'Napoles', precio_ars: 35600 },
  { linea: 'Repuestos', tipo_pieza: 'Tapa de inodoro', variante: 'Lyon', precio_ars: 38300 },
  { linea: 'Repuestos', tipo_pieza: 'Elemento de mochila', variante: 'Lira/Belmond', precio_ars: 30000 },
  { linea: 'Repuestos', tipo_pieza: 'Tapa de inodoro', variante: 'Belmond', precio_ars: 79000 },
  // Código genérico "999" del sistema de facturación (pedidos especiales, muy poco frecuentes).
  { linea: 'Otros', tipo_pieza: 'Bacha bowl monocomando', variante: '', precio_ars: 66000 },
  { linea: 'Otros', tipo_pieza: 'Mueble de vanitory', variante: 'Blanco', precio_ars: 76000 },
  { linea: 'Otros', tipo_pieza: 'Mueble de vanitory', variante: 'Wengue', precio_ars: 70000 },
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
      const precio = precioParaCalidad(item.precioListaComercial, calidad, item.tercera_sin_precio);
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
  for (const item of CATALOGO_REPUESTOS) {
    const { rows } = await client.query(
      `insert into public.piezas (linea, tipo_pieza, variante, calidad, precio_ars, precio_actualizado)
       values ($1, $2, $3, 'comercial', $4, now())
       on conflict (linea, tipo_pieza, variante, calidad)
       do update set precio_ars = excluded.precio_ars, precio_actualizado = now()
       returning (xmax = 0) as es_nueva`,
      [item.linea, item.tipo_pieza, item.variante || '', item.precio_ars]
    );
    if (rows[0].es_nueva) insertadas += 1;
    else actualizadas += 1;
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
