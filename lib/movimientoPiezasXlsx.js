// Parsea los reportes "Salidas de Stocks" que exporta el sistema de
// facturación (uno por empresa: Cerámica, Porcelanas, Presupuesto — formato
// .xlsx real, no SpreadsheetML). Es el equivalente en JS de
// scripts/parse-salidas-stock.py, para poder correrlo desde una pantalla web
// en vez de por terminal.
//
// Estructura del archivo (fila 12 = encabezado, desde fila 13 = datos, hasta
// una fila "TOTAL" al final):
//   Venta | Salida | Cliente | Item | Cantidad | Precio Vta | Costo Unit. | Costo Total | Observaciones
// Pero las columnas usadas no son las primeras 9 en orden — el archivo real
// trae columnas intermedias sin usar, por eso se leen por índice exacto
// (columna 2 = Venta, 9 = Item, 11 = Cantidad, 12 = Precio Vta), verificado
// contra archivos reales — no cambiar sin confirmar contra un archivo nuevo.
//
// - "Venta" viene como texto combinado: "dd/mm/aa  TIPO  NUMERO" (ej.
//   "02/01/26  F A  00011-00001224") — hay que separarlo en fecha/tipo/número.
//   Las notas de crédito/débito vienen igual ("NC A", "ND A").
// - "Item" viene como "CODIGO  DESCRIPCION" (ej. "0011  INODORO CORTO NAPOLES").
//   El código no siempre significa lo mismo entre líneas, así que el mapeo a
//   pieza del catálogo se hace por el texto completo del Item (código+
//   descripción), no decodificando el número — ver ITEM_A_PIEZA más abajo.

import ExcelJS from 'exceljs';

// Item (código + descripción, tal cual aparece) -> [linea, tipo_pieza, variante, calidad]
// Debe coincidir exactamente con las combinaciones cargadas en scripts/setup-piezas.cjs
// y con scripts/parse-salidas-stock.py (ITEM_A_PIEZA) — mismo mapeo, no debe divergir.
const ITEM_A_PIEZA = {
  '0011 INODORO CORTO NAPOLES': ['Napoles', 'Inodoro corto', '', '1era'],
  '0011 INODORO NAPOLES': ['Napoles', 'Inodoro corto', '', '1era'],
  '0012 INODORO CORTO NAPOLES': ['Napoles', 'Inodoro corto', '', 'comercial'],
  '0012 INODORO NAPOLES': ['Napoles', 'Inodoro corto', '', 'comercial'],
  '0013 INODORO CORTO NAPOLES': ['Napoles', 'Inodoro corto', '', '3era'],
  '0021 MOCHILA A CODO': ['Napoles', 'Deposito de codo', '', '1era'],
  '0022 MOCHILA A CODO': ['Napoles', 'Deposito de codo', '', 'comercial'],
  '0031 BIDET NAPOLES': ['Napoles', 'Bidet', '3 agujeros', '1era'],
  '0032 BIDET NAPOLES': ['Napoles', 'Bidet', '3 agujeros', 'comercial'],
  '0041 LAVATORIO': ['Napoles', 'Lavatorio', '', '1era'],
  '0042 LAVATORIO': ['Napoles', 'Lavatorio', '', 'comercial'],
  '0051 COLUMNA': ['Napoles', 'Columna', '', '1era'],
  '0052 COLUMNA': ['Napoles', 'Columna', '', 'comercial'],
  '0061 LAVATORIO MONOCOMANDO': ['Napoles', 'Lavatorio', 'Monocomando', '1era'],
  '0062 LAVATORIO MONOCOMANDO': ['Napoles', 'Lavatorio', 'Monocomando', 'comercial'],
  '0111 INODORO LARGO LYON': ['Lyon', 'Inodoro largo', '', '1era'],
  '0112 INODORO LARGO LYON': ['Lyon', 'Inodoro largo', '', 'comercial'],
  '0113 INODORO LARGO LYON': ['Lyon', 'Inodoro largo', '', '3era'],
  '0121 MOCHILA DE APOYO': ['Lyon', 'Deposito de apoyo', '', '1era'],
  '0122 MOCHILA DE APOYO': ['Lyon', 'Deposito de apoyo', '', 'comercial'],
  '0131 BIDET LYON': ['Lyon', 'Bidet', '3 agujeros', '1era'],
  '0132 BIDET LYON': ['Lyon', 'Bidet', '3 agujeros', 'comercial'],
  '0141 BIDET LYON MONOCOMANDO': ['Lyon', 'Bidet', 'Monocomando', '1era'],
  '0142 BIDET LYON MONOCOMANDO': ['Lyon', 'Bidet', 'Monocomando', 'comercial'],
  '0211 BACHA CANCUN': ['Bachas', 'Cancún', '', '1era'],
  '0212 BACHA CANCUN': ['Bachas', 'Cancún', '', 'comercial'],
  '0311 COMBO LIRA': ['Lira', 'Combo (inodoro largo + depósito)', '', '1era'],
  '0312 COMBO LIRA': ['Lira', 'Combo (inodoro largo + depósito)', '', 'comercial'],
  '0321 COMBO BELMOND': ['Belmond', 'Combo (inodoro largo + depósito)', '', '1era'],
  '0322 COMBO BELMOND': ['Belmond', 'Combo (inodoro largo + depósito)', '', 'comercial'],
  '0411 ELEMENTO DE MOCHILA': ['Repuestos', 'Elemento de mochila', '', 'comercial'],
  '0421 TAPA DE MOCHILA': ['Repuestos', 'Tapa de mochila', '', 'comercial'],
  '0431 TAPA DE INODORO FL (NÁPOLES)': ['Repuestos', 'Tapa de inodoro', 'Napoles', 'comercial'],
  '0441 TAPA DE INODORO BR (LYON)': ['Repuestos', 'Tapa de inodoro', 'Lyon', 'comercial'],
  '0451 ELEMENTO DE MOCHILA LIRA/BELMOND': ['Repuestos', 'Elemento de mochila', 'Lira/Belmond', 'comercial'],
  '0461 TAPA DE INODORO BELMOND': ['Repuestos', 'Tapa de inodoro', 'Belmond', 'comercial'],
  '999 BACHA BOWL MONOCOMANDO': ['Otros', 'Bacha bowl monocomando', '', 'comercial'],
  '999 MUEBLE DE VANITORY BLANCO': ['Otros', 'Mueble de vanitory', 'Blanco', 'comercial'],
  '999 MUEBLE DE VANITORY WENGUE': ['Otros', 'Mueble de vanitory', 'Wengue', 'comercial'],
};

// Líneas que Worcer no fabrica (son importadas) — solo tienen venta, nunca
// producción propia. Debe estar sincronizado con LINEAS_IMPORTADAS en
// public/assets/nueva-factura.js y scripts/import-salidas-stock.cjs.
export const LINEAS_IMPORTADAS = new Set(['Belmond', 'Lira']);

function sinAcentos(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function detectarEmpresa(filename) {
  const low = sinAcentos(filename.toLowerCase());
  if (low.includes('ceram')) return 'Ceramica';
  if (low.includes('porcelan')) return 'Porcelanas';
  if (low.includes('presupuesto')) return 'Presupuesto';
  return null;
}

function valorNumerico(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
  return null;
}

function parsearVenta(ventaRaw) {
  const partes = ventaRaw.trim().split(/\s+/);
  if (partes.length < 3) return null;
  const fechaRaw = partes[0];
  const numero = partes[partes.length - 1];
  const tipo = partes.slice(1, -1).join(' ');
  const [d, m, a] = fechaRaw.split('/');
  if (!d || !m || !a) return null;
  const anio = a.length === 2 ? `20${a}` : a;
  const fecha = `${anio}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return { fecha, tipo, numero };
}

async function parsearArchivo(name, buffer) {
  const empresa = detectarEmpresa(name);
  if (!empresa) {
    throw new Error(`No se pudo detectar la empresa a partir del nombre del archivo: ${name} (debe contener "Ceramica", "Porcelanas" o "Presupuesto")`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  const registros = [];
  const sinMapear = new Set();

  // worksheet.actualRowCount puede subcontar en archivos reales (visto en
  // producción: reportaba 251 con datos reales hasta la fila 256) — usar
  // rowCount, que refleja la dimensión real de la hoja.
  const totalFilas = worksheet.rowCount;
  for (let r = 13; r <= totalFilas; r++) {
    const row = worksheet.getRow(r);
    const ventaRaw = row.getCell(2).value;
    const itemRaw = row.getCell(9).value;
    const cantidadRaw = row.getCell(11).value;
    const precioRaw = row.getCell(12).value;

    if (!ventaRaw || typeof ventaRaw !== 'string') continue;
    if (ventaRaw.trim().toUpperCase().startsWith('TOTAL')) continue;

    const parsed = parsearVenta(ventaRaw);
    if (!parsed) continue;
    const { fecha, tipo: tipoComprobante, numero: numeroComprobante } = parsed;

    const itemKey = itemRaw ? String(itemRaw).trim().split(/\s+/).join(' ') : null;
    const pieza = itemKey ? ITEM_A_PIEZA[itemKey] : null;
    if (!pieza) {
      if (itemKey) sinMapear.add(itemKey);
      continue;
    }
    const [linea, tipoPieza, variante, calidad] = pieza;

    const cantidad = valorNumerico(cantidadRaw);
    const precio = valorNumerico(precioRaw);

    registros.push({
      empresa,
      fecha,
      tipo_comprobante: tipoComprobante,
      numero_comprobante: numeroComprobante,
      linea,
      tipo_pieza: tipoPieza,
      variante,
      calidad,
      cantidad: cantidad ? Math.round(cantidad) : 0,
      precio_vta: precio,
    });
  }

  return { registros, sinMapear };
}

// files: [{ name, buffer }]
export async function parseMovimientoPiezasXlsx(files) {
  const todos = [];
  const sinMapear = new Set();
  for (const { name, buffer } of files) {
    const { registros, sinMapear: sm } = await parsearArchivo(name, buffer);
    todos.push(...registros);
    sm.forEach((s) => sinMapear.add(s));
  }
  return { registros: todos, sinMapear: [...sinMapear] };
}
