// Parsea "Solicitud de Compra.xlsx" — el tablero de solicitudes de compra que
// arma Víctor, una sola hoja larga. Encabezado en la fila 4:
//   Nº | Estado | Fecha de Pedido | Cantidad | Descripcion | Proveedor
//   Sugerido | Precio Unitario | Total | Forma de pago | Fecha de Necesidad |
//   Nº Factura | F.Compra | F.Recepcion | Solicitante | Supervisa | Aprobado
// Solo cuentan como compra real las filas con Estado="OK" (no las
// rechazadas) que además tengan F.Compra cargada (si no, es un pedido
// aprobado pero todavía no comprado) y un proveedor sugerido real (no vacío
// ni "X", que se usa como placeholder de "sin definir").
import ExcelJS from 'exceljs';

const COL = {
  estado: 2, fechaPedido: 3, cantidad: 4, descripcion: 5, proveedor: 6,
  precioUnitario: 7, total: 8, fCompra: 12,
};

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

const PROVEEDOR_VACIO = new Set(['', 'X']);

export async function parseComprasProveedorXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  const registros = [];
  let noAprobadas = 0;
  let sinFCompra = 0;
  let sinProveedor = 0;

  const totalFilas = worksheet.rowCount;
  for (let r = 5; r <= totalFilas; r++) {
    const row = worksheet.getRow(r);
    const descripcion = valorTexto(row.getCell(COL.descripcion).value);
    if (!descripcion) break; // fin de los datos reales

    const estado = valorTexto(row.getCell(COL.estado).value).toUpperCase();
    const fCompra = valorFecha(row.getCell(COL.fCompra).value);
    const proveedor = valorTexto(row.getCell(COL.proveedor).value);

    if (estado !== 'OK') { noAprobadas += 1; continue; }
    if (!fCompra) { sinFCompra += 1; continue; }
    if (PROVEEDOR_VACIO.has(proveedor.toUpperCase())) { sinProveedor += 1; continue; }

    registros.push({
      fecha: fCompra,
      cantidad: valorNumerico(row.getCell(COL.cantidad).value),
      descripcion,
      proveedor,
      precioUnitario: valorNumerico(row.getCell(COL.precioUnitario).value),
      monto: valorNumerico(row.getCell(COL.total).value),
    });
  }

  return { registros, noAprobadas, sinFCompra, sinProveedor };
}
