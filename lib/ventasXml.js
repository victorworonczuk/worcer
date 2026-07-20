// Parsea los reportes de ventas que exporta el sistema de facturación
// (formato SpreadsheetML / "Excel XML"), uno por empresa: Cerámica, Porcelanas,
// Presupuesto. Ver scripts/parse-ventas-xml.py para la versión Python original
// (misma lógica, se mantuvo acá también porque el import por pantalla corre en
// el servidor de Next.js, que no tiene Python disponible).

function sinAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function detectEmpresa(filename) {
  const low = sinAcentos(filename.toLowerCase());
  if (low.includes('ceram')) return 'Ceramica';
  if (low.includes('porcelan')) return 'Porcelanas';
  if (low.includes('presupuesto')) return 'Presupuesto';
  return null;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseFilas(xmlText) {
  const rowBlocks = xmlText.match(/<Row[^>]*>[\s\S]*?<\/Row>/g) || [];
  return rowBlocks
    .map((rowXml) => {
      // Ojo: una celda vacía puede venir como tag autocerrado (<Cell ... />),
      // sin <Data> adentro — si no se contempla ese caso, se la salta y todas
      // las columnas siguientes de esa fila quedan corridas una posición.
      const cellBlocks = rowXml.match(/<Cell[^>]*\/>|<Cell[^>]*>[\s\S]*?<\/Cell>/g) || [];
      const celdas = {};
      let col = 0;
      for (const cellXml of cellBlocks) {
        const idxMatch = cellXml.match(/ss:Index="(\d+)"/);
        if (idxMatch) col = Number(idxMatch[1]) - 1;
        const dataMatch = cellXml.match(/<Data[^>]*>([\s\S]*?)<\/Data>/);
        celdas[col] = dataMatch ? decodeXmlEntities(dataMatch[1].trim()) : '';
        col += 1;
      }
      return celdas;
    })
    .filter((c) => Object.keys(c).length > 0);
}

// Devuelve [{ empresa, fecha, tipo_comprobante, numero_comprobante, cuit_original,
//             cuit_normalizado, nombre_facturado, importe_ars }, ...]
export function parseVentasXml(xmlText, filename) {
  const empresa = detectEmpresa(filename);
  if (!empresa) {
    throw new Error(`No pude detectar la empresa a partir del nombre de archivo: ${filename} (debe contener "Cerámica", "Porcelanas" o "Presupuesto")`);
  }

  const filas = parseFilas(xmlText);
  if (filas.length < 2) return [];

  // Fila 0 = encabezado de grupos (se ignora), fila 1 = nombres de columna reales.
  const encabezado = filas[1];
  const colPorNombre = {};
  for (const idx of Object.keys(encabezado)) {
    const nombre = encabezado[idx];
    if (!(nombre in colPorNombre)) colPorNombre[nombre] = Number(idx);
  }

  const requeridas = ['Fecha', 'Tipo', 'Nº', 'CUIT', 'Nombre o Razón Social', 'Total'];
  const faltantes = requeridas.filter((c) => !(c in colPorNombre));
  if (faltantes.length) {
    throw new Error(`${filename}: faltan columnas esperadas (${faltantes.join(', ')}) — encabezado leído: ${JSON.stringify(encabezado)}`);
  }

  const registros = [];
  for (const fila of filas.slice(2)) {
    const primera = fila[0] || '';
    if (primera.startsWith('Total') || primera.startsWith('A Asentar')) continue;
    const fechaRaw = fila[colPorNombre['Fecha']] || '';
    if (!fechaRaw) continue;
    const fecha = fechaRaw.split('T')[0];
    const cuit = fila[colPorNombre['CUIT']] || '';
    const total = Number(fila[colPorNombre['Total']] || '0');
    if (Number.isNaN(total)) continue;
    registros.push({
      empresa,
      fecha,
      tipo_comprobante: fila[colPorNombre['Tipo']] || null,
      numero_comprobante: fila[colPorNombre['Nº']] || null,
      cuit_original: cuit || null,
      cuit_normalizado: cuit ? cuit.replace(/\D/g, '') || null : null,
      nombre_facturado: fila[colPorNombre['Nombre o Razón Social']] || '',
      importe_ars: total,
    });
  }
  return registros;
}

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export function mesDe(fechaIso) {
  return MESES[Number(fechaIso.slice(5, 7)) - 1];
}
