// Parsea el "TABLERO PEDIDOS DE VENTA" (una hoja por mes, nombrada YYYY-MM).
// Cada hoja trae dos tablas apiladas, ambas con una fila por vendedor y una
// columna por día hábil del mes:
//   "CANTIDAD DE PEDIDOS"  — cantidad de pedidos por vendedor y día
//   "PEDIDOS VALORIZADOS"  — monto ARS de esos pedidos, mismo layout
// Después de las columnas de fecha vienen columnas de resumen (Total,
// Proyectado, Promedio, %, Mes anterior, Proy/MA) que se ignoran acá.
import ExcelJS from 'exceljs';

const NOMBRE_HOJA = /^\d{4}-\d{2}$/;

// Lista de vendedores real (debe estar sincronizada con VENDEDORES en
// public/assets/app.js — se duplica acá porque ese archivo es un <script>
// suelto sin módulos, mismo criterio que fetchAll() en el resto del proyecto).
const VENDEDORES = [
  'Sergio Nastaskin', 'Hernán Acosta', 'Walter Vernola', 'Alejandro Vernola', 'Jose Gil',
  'Javier Viglino', 'Francisco Baez', 'Martín Argento', 'Darío Frank', 'Walter Fogar',
  'Mariano Cabarrus', 'Sebastián Guerra', 'Horacio Vostrosky', 'Víctor W.',
];

// Overrides que no se pueden resolver por texto (no son variantes/typos del
// nombre, son una reasignación de criterio, confirmada con Víctor).
const RENOMBRAR = {
  'VENTA ONLINE': 'Víctor W.', // pedidos propios de Víctor, no de un vendedor de planta.
  'HORACIO V': 'Horacio Vostrosky', // abreviado, no lo resuelve el matching por typo/orden.
};

// Filas combinadas donde el reparto genérico (separar por "Y"/"/" y resolver
// cada parte) no alcanza porque una de las partes es ambigua por sí sola
// (ej. "Walter" solo podría ser Walter Vernola o Walter Fogar) — confirmado
// a mano con Víctor. Se reparte en partes iguales entre los dos.
const COMBINADAS = {
  'WALTER Y ALEJANDRO VERNLA': ['Walter Vernola', 'Alejandro Vernola'],
};

// Filas que todavía no se sabe a quién corresponden — se ignoran en vez de
// adivinar (ver "Dieu José", pendiente de confirmar con Víctor).
const IGNORAR = new Set(['DIEU JOSE', 'DIEU JOSÉ']);

function sinAcentos(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function norm(s) {
  return sinAcentos(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const VENDEDORES_NORM = VENDEDORES.map((v) => ({ canonico: v, norm: norm(v), tokens: norm(v).split(' ') }));
const RENOMBRAR_NORM = new Map(Object.entries(RENOMBRAR).map(([k, v]) => [norm(k), v]));
const COMBINADAS_NORM = new Map(Object.entries(COMBINADAS).map(([k, v]) => [norm(k), v]));
const IGNORAR_NORM = new Set([...IGNORAR].map(norm));

function distanciaEdicion(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Intenta resolver UN nombre (no una fila combinada) contra la lista de
// vendedores reales: exacto -> un solo token que identifica a un único
// vendedor (nombre de pila o apellido) -> typo chico (distancia de edición).
function resolverUnVendedor(labelRaw) {
  const n = norm(labelRaw);
  if (!n) return null;

  const exacto = VENDEDORES_NORM.find((v) => v.norm === n);
  if (exacto) return exacto.canonico;

  const tokensLabel = n.split(' ');

  // Mismos tokens en otro orden (apellido antes que nombre, ej. "Fogar Walter").
  const tokensOrdenLabel = [...tokensLabel].sort().join(' ');
  const mismoOrden = VENDEDORES_NORM.find((v) => [...v.tokens].sort().join(' ') === tokensOrdenLabel);
  if (mismoOrden) return mismoOrden.canonico;

  if (tokensLabel.length === 1) {
    const candidatos = VENDEDORES_NORM.filter((v) => v.tokens.includes(tokensLabel[0]));
    if (candidatos.length === 1) return candidatos[0].canonico;
  }

  let mejor = null;
  let mejorDist = Infinity;
  for (const v of VENDEDORES_NORM) {
    const d = distanciaEdicion(n, v.norm);
    if (d < mejorDist) { mejorDist = d; mejor = v; }
  }
  if (mejor && mejorDist <= 2 && mejorDist < n.length * 0.3) return mejor.canonico;
  return null;
}

// Resuelve una fila del archivo (puede ser un vendedor solo o una fila
// combinada tipo "Walter Y Alejandro Vernola" / "Jose Gil / Javier Viglino").
// Devuelve: [] (ignorar), null (no se pudo resolver, reportar), o la lista de
// vendedores canónicos entre los que hay que repartir el valor de la fila.
function resolverFila(labelRaw) {
  const n = norm(labelRaw);
  if (IGNORAR_NORM.has(n)) return [];
  if (RENOMBRAR_NORM.has(n)) return [RENOMBRAR_NORM.get(n)];
  if (COMBINADAS_NORM.has(n)) return COMBINADAS_NORM.get(n);

  const partes = labelRaw.split(/\s+Y\s+|\/|,/i).map((p) => p.trim()).filter(Boolean);
  if (partes.length > 1) {
    const resueltos = partes.map(resolverUnVendedor);
    return resueltos.every(Boolean) ? resueltos : null;
  }

  const uno = resolverUnVendedor(labelRaw);
  return uno ? [uno] : null;
}

function buscarFilaLabel(worksheet, label) {
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= 5; c++) {
      if (norm(row.getCell(c).value) === label) return r;
    }
  }
  return null;
}

function fechaISO(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Lee una tabla (bloque "CANTIDAD DE PEDIDOS" o "PEDIDOS VALORIZADOS"):
// fila de label -> fila de encabezados (Vendedor, fecha, fecha, ...) -> filas
// de datos hasta la fila "Total".
function leerBloque(worksheet, filaLabel) {
  const filaHeader = filaLabel + 1;
  const header = worksheet.getRow(filaHeader);
  const columnasFecha = [];
  for (let c = 2; c <= worksheet.columnCount; c++) {
    const v = header.getCell(c).value;
    if (v instanceof Date) columnasFecha.push({ col: c, fecha: fechaISO(v) });
    else if (v == null) continue;
    else break; // "Total": fin de las columnas de fecha
  }

  const filas = [];
  let r = filaHeader + 1;
  while (r <= worksheet.rowCount) {
    const row = worksheet.getRow(r);
    const vendedorRaw = row.getCell(1).value;
    if (vendedorRaw == null || String(vendedorRaw).trim() === '') break;
    const nombreRaw = String(vendedorRaw).trim();
    if (norm(nombreRaw) === 'TOTAL') break;
    for (const { col, fecha } of columnasFecha) {
      const valor = row.getCell(col).value;
      filas.push({ vendedorRaw: nombreRaw, fecha, valor: typeof valor === 'number' ? valor : 0 });
    }
    r += 1;
  }
  return filas;
}

function acumular(porClave, sinMapear, filas, campo) {
  for (const { vendedorRaw, fecha, valor } of filas) {
    const resueltos = resolverFila(vendedorRaw);
    if (resueltos === null) { sinMapear.add(vendedorRaw); continue; }
    if (resueltos.length === 0) continue; // ignorado a propósito
    const valorPorVendedor = valor / resueltos.length;
    for (const vendedor of resueltos) {
      const key = `${vendedor}|${fecha}`;
      if (!porClave.has(key)) porClave.set(key, { vendedor, fecha, cantidad: 0, monto_ars: 0 });
      porClave.get(key)[campo] += valorPorVendedor;
    }
  }
}

// Devuelve { filas: [{ vendedor, fecha, cantidad, monto_ars }], sinMapear: string[] }
// sinMapear son etiquetas del archivo que no se pudieron resolver a ningún
// vendedor conocido — hay que revisarlas a mano, no se inventan datos.
export async function parsePedidosVendedorXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const porClave = new Map();
  const sinMapear = new Set();

  for (const worksheet of workbook.worksheets) {
    if (!NOMBRE_HOJA.test(worksheet.name.trim())) continue;

    const filaCantidad = buscarFilaLabel(worksheet, 'CANTIDAD DE PEDIDOS');
    const filaMonto = buscarFilaLabel(worksheet, 'PEDIDOS VALORIZADOS');
    if (filaCantidad == null || filaMonto == null) continue;

    acumular(porClave, sinMapear, leerBloque(worksheet, filaCantidad), 'cantidad');
    acumular(porClave, sinMapear, leerBloque(worksheet, filaMonto), 'monto_ars');
  }

  return { filas: [...porClave.values()], sinMapear: [...sinMapear] };
}
