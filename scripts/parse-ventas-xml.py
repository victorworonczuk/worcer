#!/usr/bin/env python3
"""
Lee los reportes de ventas que exporta el sistema de facturación (formato
SpreadsheetML / "Excel XML", uno por empresa: Cerámica, Porcelanas, Presupuesto)
y genera ventas_export.json, que después carga import-ventas.cjs en `facturas`.

Cada archivo tiene dos filas de encabezado, después una fila por comprobante
(factura o nota de crédito/débito), y termina con una fila "Total (pesos):" y
una "A Asentar:" que se descartan. Cerámica/Porcelanas traen desglose de IVA
(columna CAE de por medio); Presupuesto no factura IVA discriminado y no tiene
columna CAE, así que tiene una columna menos — por eso se lee por nombre de
columna (leído del propio encabezado), no por posición fija.

Uso:
    python3 scripts/parse-ventas-xml.py "Ventas Cerámica Junio 2026.xml" "Ventas Porcelanas Junio 2026.xml" "Ventas Presupuesto Junio 2026.xml"

La empresa se detecta del nombre de archivo (debe contener "ceram", "porcelan"
o "presupuesto", sin importar mayúsculas/acentos).
"""
import json, os, re, sys, unicodedata
import xml.etree.ElementTree as ET

NS = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
OUT = os.path.join(os.path.dirname(__file__), "..", "ventas_export.json")


def norm(s):
    return " ".join(str(s).split()).strip() if s is not None else ""


def sin_acentos(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def detect_empresa(filename):
    low = sin_acentos(filename.lower())
    if "ceram" in low:
        return "Ceramica"
    if "porcelan" in low:
        return "Porcelanas"
    if "presupuesto" in low:
        return "Presupuesto"
    raise ValueError(f"No pude detectar la empresa a partir del nombre de archivo: {filename}")


def leer_filas(path):
    tree = ET.parse(path)
    root = tree.getroot()
    worksheet = root.find("ss:Worksheet", NS)
    table = worksheet.find("ss:Table", NS)

    filas = []
    for row in table.findall("ss:Row", NS):
        celdas = {}
        col = 0
        for cell in row.findall("ss:Cell", NS):
            idx_attr = cell.get("{urn:schemas-microsoft-com:office:spreadsheet}Index")
            if idx_attr:
                col = int(idx_attr) - 1
            data = cell.find("ss:Data", NS)
            celdas[col] = norm(data.text) if data is not None and data.text else ""
            col += 1
        if celdas:
            filas.append(celdas)
    return filas


def parsear_archivo(path):
    empresa = detect_empresa(os.path.basename(path))
    filas = leer_filas(path)
    if len(filas) < 2:
        return []

    # Fila 1 = encabezado de grupos (se ignora), fila 2 = nombres de columna reales.
    encabezado = filas[1]
    col_por_nombre = {}
    for idx, nombre in encabezado.items():
        col_por_nombre.setdefault(nombre, idx)

    requeridas = ["Fecha", "Tipo", "Nº", "CUIT", "Nombre o Razón Social", "Total"]
    faltantes = [c for c in requeridas if c not in col_por_nombre]
    if faltantes:
        raise ValueError(f"{path}: faltan columnas esperadas {faltantes} (encabezado leído: {encabezado})")

    registros = []
    for fila in filas[2:]:
        primera = fila.get(0, "")
        if primera.startswith("Total") or primera.startswith("A Asentar"):
            continue
        fecha_raw = fila.get(col_por_nombre["Fecha"], "")
        if not fecha_raw:
            continue
        fecha = fecha_raw.split("T")[0]
        cuit = fila.get(col_por_nombre["CUIT"], "")
        total_raw = fila.get(col_por_nombre["Total"], "0")
        try:
            total = float(total_raw)
        except ValueError:
            continue
        registros.append({
            "empresa": empresa,
            "fecha": fecha,
            "tipo_comprobante": fila.get(col_por_nombre["Tipo"], ""),
            "numero_comprobante": fila.get(col_por_nombre["Nº"], "") or None,
            "cuit_original": cuit or None,
            "cuit_normalizado": re.sub(r"\D", "", cuit) or None,
            "nombre_facturado": fila.get(col_por_nombre["Nombre o Razón Social"], ""),
            "importe_ars": total,
        })
    return registros


def main():
    paths = sys.argv[1:]
    if not paths:
        print("Uso: python3 scripts/parse-ventas-xml.py archivo1.xml [archivo2.xml ...]")
        sys.exit(1)

    todos = []
    for path in paths:
        registros = parsear_archivo(path)
        print(f"{os.path.basename(path)}: {len(registros)} comprobantes leídos ({detect_empresa(path)})")
        todos.extend(registros)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)
    print(f"\nTotal: {len(todos)} comprobantes -> {OUT}")


if __name__ == "__main__":
    main()
