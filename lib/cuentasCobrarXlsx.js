// Parsea "Cuentas a cobrar.xlsx" — tres hojas con formato fijo:
//   "2026"                : facturas pendientes de cobro (encabezado fila 3,
//                           datos desde fila 4: Empresa | Fecha Em. | Factura
//                           | Cliente | Monto | Entregado | F. est de Pago |
//                           Vendedor)
//   "Morosos"              : mismas columnas que "2026", clientes morosos
//                           históricos — se cargan en la misma tabla
//                           (cuentas_cobrar) con origen='moroso'.
//   "Cheques rechazados"   : Empresa | Fecha ND | ND | Cliente | Monto debido
//                           | Monto recuperado | Saldo | Nº CHEQUE | TIPO
//                           CHEQUE | ESTADO | Fecha de recupero | Vendedor
// Se corta la lectura de cada hoja en la primera fila sin Empresa (columna A).
import ExcelJS from 'exceljs';

function valorNumerico(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  return null;
}

function valorTexto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && typeof v.result === 'string') return v.result.trim();
  return String(v).trim();
}

function valorFecha(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

function hojaPorNombre(workbook, nombre) {
  return workbook.worksheets.find((ws) => ws.name.trim().toLowerCase() === nombre.toLowerCase()) || null;
}

function parsearCuentasCobrar(worksheet, origen) {
  const filas = [];
  const totalFilas = worksheet.rowCount;
  for (let r = 4; r <= totalFilas; r++) {
    const row = worksheet.getRow(r);
    const empresa = valorTexto(row.getCell(1).value);
    if (!empresa) break;

    filas.push({
      empresa,
      fecha_emision: valorFecha(row.getCell(2).value),
      numero_factura: valorTexto(row.getCell(3).value) || null,
      cliente_nombre: valorTexto(row.getCell(4).value),
      monto: valorNumerico(row.getCell(5).value),
      fecha_entrega: valorFecha(row.getCell(6).value),
      fecha_estimada_pago: valorFecha(row.getCell(7).value),
      vendedor_crudo: valorTexto(row.getCell(8).value) || null,
      origen,
    });
  }
  return filas;
}

function parsearChequesRechazados(worksheet) {
  const filas = [];
  const totalFilas = worksheet.rowCount;
  for (let r = 4; r <= totalFilas; r++) {
    const row = worksheet.getRow(r);
    const empresa = valorTexto(row.getCell(1).value);
    if (!empresa) break;

    filas.push({
      empresa,
      fecha_nd: valorFecha(row.getCell(2).value),
      numero_nd: valorTexto(row.getCell(3).value) || null,
      cliente_nombre: valorTexto(row.getCell(4).value),
      monto_debido: valorNumerico(row.getCell(5).value),
      monto_recuperado: valorNumerico(row.getCell(6).value),
      saldo: valorNumerico(row.getCell(7).value),
      numero_cheque: valorTexto(row.getCell(8).value) || null,
      tipo_cheque: valorTexto(row.getCell(9).value) || null,
      estado: valorTexto(row.getCell(10).value) || null,
      fecha_recupero: valorFecha(row.getCell(11).value),
      vendedor_crudo: valorTexto(row.getCell(12).value) || null,
    });
  }
  return filas;
}

export async function parseCuentasCobrarXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const hojaPendientes = hojaPorNombre(workbook, '2026');
  const hojaMorosos = hojaPorNombre(workbook, 'Morosos');
  const hojaCheques = hojaPorNombre(workbook, 'Cheques rechazados');

  return {
    cuentasCobrar: [
      ...(hojaPendientes ? parsearCuentasCobrar(hojaPendientes, 'pendiente') : []),
      ...(hojaMorosos ? parsearCuentasCobrar(hojaMorosos, 'moroso') : []),
    ],
    chequesRechazados: hojaCheques ? parsearChequesRechazados(hojaCheques) : [],
  };
}
