// Parsea "Caja 2026.xlsx" — el libro de caja diario que arma Víctor a mano,
// una hoja por mes (Enero, Febrero, ...). Encabezado en la fila 1:
//   Fecha | Cuenta | Detalle | Entrada | Salida | Saldo
// La primera fila de cada mes es "SALDO INICIAL" (Cuenta vacía, Saldo = el
// saldo con el que arranca el mes) — se marca aparte con es_saldo_inicial.
//
// El archivo trae fórmulas arrastradas mucho más abajo de los datos reales
// (la columna Saldo copiada hasta la fila 1000+, evaluando a 0 sin fecha
// asociada) — se corta la lectura de cada hoja en la primera fila sin una
// fecha válida en la columna A, que es donde termina la carga real.
import ExcelJS from 'exceljs';

const HEADER_ESPERADO = ['fecha', 'cuenta', 'detalle', 'entrada', 'salida', 'saldo'];

function valorNumerico(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  return 0;
}

function valorTexto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && typeof v.result === 'string') return v.result.trim();
  return String(v).trim();
}

function esFechaValida(v) {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

function fechaAIso(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function parsearArchivo(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const registros = [];
  for (const worksheet of workbook.worksheets) {
    const headerRow = worksheet.getRow(1);
    const header = [1, 2, 3, 4, 5, 6].map((c) => valorTexto(headerRow.getCell(c).value).toLowerCase());
    const headerOk = HEADER_ESPERADO.every((h, i) => header[i] === h);
    if (!headerOk) continue; // hoja que no es un mes de caja (p. ej. una portada) — se ignora

    const totalFilas = worksheet.rowCount;
    for (let r = 2; r <= totalFilas; r++) {
      const row = worksheet.getRow(r);
      const fechaRaw = row.getCell(1).value;
      if (!esFechaValida(fechaRaw)) break; // fin de los datos reales de esta hoja

      const detalle = valorTexto(row.getCell(3).value);
      const esSaldoInicial = detalle.toUpperCase() === 'SALDO INICIAL';

      registros.push({
        fecha: fechaAIso(fechaRaw),
        cuenta: esSaldoInicial ? 'Saldo inicial' : valorTexto(row.getCell(2).value),
        detalle,
        entrada: valorNumerico(row.getCell(4).value),
        salida: valorNumerico(row.getCell(5).value),
        saldo: valorNumerico(row.getCell(6).value),
        es_saldo_inicial: esSaldoInicial,
      });
    }
  }
  return registros;
}

// files: [{ name, buffer }]
export async function parseCajaXlsx(files) {
  const todos = [];
  for (const f of files) {
    const registros = await parsearArchivo(f.buffer);
    todos.push(...registros);
  }
  return todos;
}
