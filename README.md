# Worcer CRM

Panel interno para gestionar la base de clientes históricos y activos de Worcer (873 registros: 561 dormidos + 312 activos 2025-2026).

## Stack

- Frontend: HTML/CSS/JS plano (sin build step), Supabase JS v2 vía CDN.
- Base de datos: Supabase (Postgres).
- Hosting: Vercel, Framework Preset = **Other** (sirve los archivos estáticos tal cual).

## Estructura

- `index.html` — dashboard principal (filtros, tabla, edición de estado/notas).
- `assets/config.js` — URL y clave pública (`sb_publishable_...`) de Supabase.
- `assets/app.js` — lógica de carga, filtros, paginación y guardado.
- `assets/style.css` — estilos.
- `schema.sql` — definición de la tabla `clientes`.
- `scripts/import-data.js` — importa `clientes_export.json` a Supabase (trunca e inserta de nuevo).
- `clientes_export.json` — snapshot de los datos exportados desde el Excel "Base Unificada".

## Campos de la tabla `clientes`

Incluye los datos de la base unificada (CUIT, ubicación, segmento A-F, facturación 2025-2026, datos de contacto encontrados) más dos campos de gestión:

- `estado_contacto`: `pendiente` | `contactado` | `recuperado` | `descartado`
- `notas`: texto libre

## Re-importar datos

Si el Excel cambia y hay que refrescar la base:

```bash
# 1. Re-exportar desde el Excel (ver el script de export usado originalmente)
# 2. Reinstalar dependencias si hace falta
npm install
# 3. Importar (esto BORRA y reinserta todo)
node scripts/import-data.js
```

## Notas

- No hay login: cualquiera con la URL puede ver y editar. Aceptado para esta primera etapa; agregar Supabase Auth antes de compartir el link ampliamente.
- Los segmentos A-E (312 clientes activos 2025-2026) tienen los campos de contacto vacíos a propósito — Worcer los tiene que exportar de su sistema de facturación y cargarlos acá.
