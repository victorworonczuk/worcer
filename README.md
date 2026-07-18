# Worcer CRM

Panel interno para gestionar la base de clientes históricos y activos de Worcer (873 registros: 561 dormidos + 312 activos 2025-2026), más el detalle de 1.615 facturas.

## Stack

- Next.js (App Router) — solo para servir el sitio protegido con login y habilitar API routes server-side a futuro (envío de emails con Resend, operaciones privilegiadas en Supabase).
- El dashboard en sí sigue siendo HTML/CSS/JS plano (sin frameworks), servido desde `/public`, con Supabase JS v2 vía CDN para leer/escribir datos.
- Base de datos: Supabase (Postgres).
- Hosting: Vercel.

## Autenticación

Todo el sitio está protegido con HTTP Basic Auth (`proxy.js`, corre en cada request). Usuario y clave se definen por variables de entorno:

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASS`

**Importante**: esto protege el *sitio*, no la base de datos en sí. Supabase tiene RLS desactivado por velocidad en esta primera etapa — cualquiera que consiga la URL + clave pública de Supabase (visibles en `public/assets/config.js`) puede leer/escribir la tabla directamente, sin pasar por el login del sitio. Para cerrar eso hace falta Supabase Auth + políticas RLS.

## Variables de entorno

Ver `.env.example`. En local van en `.env.local` (gitignoreado). En producción hay que cargarlas en Vercel: Project Settings → Environment Variables.

- `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` — login del sitio.
- `RESEND_API_KEY` — para cuando se implemente el envío de emails de la campaña de recupero (todavía no hay ninguna ruta que la use).

## Estructura

- `public/index.html` — dashboard principal (filtros, tabla, edición de estado/notas).
- `public/assets/config.js` — URL y clave pública (`sb_publishable_...`) de Supabase.
- `public/assets/app.js` — lógica de carga, filtros, paginación y guardado.
- `public/assets/style.css` — estilos.
- `app/page.js` — redirige `/` a `/index.html`.
- `proxy.js` — Basic Auth para todo el sitio.
- `schema.sql` / `schema_facturas.sql` — definición de las tablas `clientes` y `facturas`.
- `scripts/import-data.cjs` — importa `clientes_export.json` (base unificada) a Supabase.
- `scripts/import-facturas.cjs` — importa `facturas_export.json` (detalle de facturación) a Supabase y las vincula a `clientes` por CUIT.

## Tablas

**`clientes`**: datos de la base unificada (CUIT, ubicación, segmento A-F, facturación total 2025-2026, datos de contacto encontrados) más dos campos de gestión:

- `estado_contacto`: `pendiente` | `contactado` | `recuperado` | `descartado`
- `notas`: texto libre

**`facturas`**: detalle factura por factura (línea Cerámica/Porcelanas, fecha, importe ARS/USD), vinculada a `clientes` vía `cliente_id` cuando el CUIT coincide.

## Correr en local

```bash
npm install
npm run dev
# http://localhost:3000 (pide usuario/clave de BASIC_AUTH_*)
```

## Re-importar datos

Si el Excel cambia y hay que refrescar la base (esto BORRA y reinserta todo):

```bash
node scripts/import-data.cjs
node scripts/import-facturas.cjs
```

## Pendiente

- Los segmentos A-E (312 clientes activos 2025-2026) tienen los campos de contacto vacíos a propósito — Worcer los tiene que exportar de su sistema de facturación y cargarlos acá.
- Endpoint de envío de emails (Resend) — todavía no implementado, a definir junto con la estrategia de recontactación.
- RLS en Supabase si se quiere cerrar el acceso directo a la base (ver nota de seguridad arriba).
