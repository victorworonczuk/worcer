# Worcer CRM

Panel interno para gestionar la base de clientes históricos y activos de Worcer (873 registros: 561 dormidos + 312 activos 2025-2026), más el detalle de facturación (histórico importado + carga diaria manual).

## Stack

- Next.js (App Router) — sirve el sitio protegido con login y expone API routes server-side (login/logout/me hoy; envío de emails con Resend a futuro).
- El dashboard y la carga de facturas son HTML/CSS/JS plano (sin frameworks), servidos desde `/public`, con Supabase JS v2 vía CDN para leer/escribir datos.
- Base de datos: Supabase (Postgres).
- Hosting: Vercel.

## Autenticación (multi-usuario)

Login con formulario propio (no el diálogo nativo del navegador, para que el gestor de contraseñas del navegador pueda ofrecer guardarla) y usuarios individuales guardados en la tabla `usuarios`:

- `app/login/page.js` — pantalla de login.
- `app/api/login/route.js` — busca el `username` en la tabla `usuarios` (vía `DATABASE_URL`, conexión directa a Postgres — no pasa por la API pública de Supabase), valida la clave con `scrypt`, y si es correcta firma una cookie `worcer_auth` = `usuario:expiración:HMAC-SHA256(SESSION_SECRET)`.
- `proxy.js` (Edge) — en cada request salvo `/login` y `/api/login`, verifica la firma HMAC de la cookie con Web Crypto; si no es válida, redirige a `/login`.
- `app/api/me/route.js` — devuelve el usuario logueado (lo consume el frontend para mostrar "Sesión: x" y para completar `cargado_por` al cargar una factura).
- `app/api/logout/route.js` — borra la cookie.

Administrar usuarios: editar el array `USUARIOS` en `scripts/setup-usuarios.cjs` y correr `node scripts/setup-usuarios.cjs` (crea o actualiza por `username`, imprime las claves una sola vez).

**Importante**: esto protege el *sitio*. La tabla `usuarios` está explícitamente bloqueada para la clave pública de Supabase (ver nota de seguridad abajo), pero `clientes` y `facturas` no — cualquiera que consiga la URL + clave pública de Supabase (visibles en `public/assets/config.js`) puede leer/escribir esas dos tablas directamente, sin pasar por el login del sitio. Para cerrar eso hace falta Supabase Auth + políticas RLS reales.

### ⚠️ Nota de seguridad — privilegios por defecto de Supabase

Supabase le otorga privilegios por defecto a los roles `anon`/`authenticated` sobre **tablas nuevas** del schema `public`, aunque no se los pidamos explícitamente con `GRANT`. Lo descubrimos cuando la tabla `usuarios` (con hashes de contraseñas) quedó legible con la clave pública sin que nadie se lo otorgara. Cualquier tabla nueva que no deba ser pública necesita, explícitamente:

```sql
revoke all on public.<tabla> from anon, authenticated, public;
alter table public.<tabla> enable row level security;
alter table public.<tabla> force row level security;
```

(ver `schema_usuarios.sql` para el caso real). No asumir que "no otorgué permisos" = "está protegida".

## Variables de entorno

Ver `.env.example`. En local van en `.env.local` (gitignoreado). En producción hay que cargarlas en Vercel: Project Settings → Environment Variables.

- `SESSION_SECRET` — valor aleatorio usado para firmar la cookie de sesión (generar con `openssl rand -hex 24`).
- `DATABASE_URL` — connection string de Postgres. **Ahora es obligatoria en producción** (antes era opcional): la usan los scripts de import y, sobre todo, `/api/login` para validar usuarios contra la tabla `usuarios`.
- `RESEND_API_KEY` — usada por `/api/send-email`. **El dominio `porcelanasalberti.com.ar` todavía no está verificado en Resend** ([resend.com/domains](https://resend.com/domains)) — hasta que se verifique, Resend rechaza cualquier envío desde ese dominio con `403 domain not verified`.

## Estructura

- `public/index.html` — dashboard principal (filtros, tabla, edición de estado/notas, plantillas de mensaje).
- `public/nueva-factura.html` — carga diaria de facturas por parte de empleados (ver abajo).
- `public/piezas.html` — análisis de piezas vendidas por cliente/período (ver abajo).
- `public/assets/config.js` — URL y clave pública (`sb_publishable_...`) de Supabase.
- `public/assets/app.js` — lógica del dashboard.
- `public/assets/nueva-factura.js` — lógica de la carga de facturas.
- `public/assets/piezas.js` — lógica del análisis de piezas.
- `public/assets/style.css` / `nueva-factura.css` / `piezas.css` — estilos.
- `app/page.js` — redirige `/` a `/index.html`.
- `app/login/page.js`, `app/api/login`, `app/api/logout`, `app/api/me` — autenticación (ver más arriba).
- `app/api/send-email/route.js` — envía un email vía Resend. Requiere sesión válida, y el `from` tiene que ser `ventas@porcelanasalberti.com.ar` o `administracion@porcelanasalberti.com.ar` (whitelist server-side, no se puede mandar desde cualquier dirección).
- `proxy.js` — protege todo el sitio salvo `/login` y `/api/login`.
- `schema.sql` / `schema_facturas.sql` / `schema_usuarios.sql` / `schema_piezas.sql` — definición de las tablas.
- `scripts/import-data.cjs` — importa `clientes_export.json` (base unificada) a Supabase.
- `scripts/import-facturas.cjs` — importa `facturas_export.json` (detalle histórico de facturación) a Supabase y las vincula a `clientes` por CUIT.
- `scripts/setup-usuarios.cjs` — crea/actualiza los logins.
- `scripts/setup-piezas.cjs` — crea/actualiza el catálogo de piezas (idempotente, no duplica si ya existen).

## Tablas

**`clientes`**: datos de la base unificada (CUIT, ubicación, segmento A-F, facturación total 2025-2026, datos de contacto encontrados) más dos campos de gestión:

- `estado_contacto`: `pendiente` | `contactado` | `recuperado` | `descartado`
- `notas`: texto libre

**`facturas`**: detalle factura por factura (línea, fecha, importe ARS/USD), vinculada a `clientes` vía `cliente_id` cuando el CUIT coincide. `cargado_por` es `null` en las 1.615 filas del import histórico, y tiene el username de quien la cargó a mano desde `/nueva-factura.html`.

**`usuarios`**: login de cada persona (`username`, `password_hash` + `salt` con scrypt, `nombre`, `rol`). No accesible vía API pública de Supabase (ver nota de seguridad).

**`piezas`**: catálogo de producto — combinaciones válidas de `linea` (Napoles, Lyon, Lira, Belmond, Bachas) × `tipo_pieza` × `variante` (los bidet tienen "3 agujeros" / "Monocomando", mismo precio en ambos) × `calidad` (`1era` / `comercial` / `3era`) × `precio_ars`. La `3era` solo existe en los inodoros sueltos (Inodoro corto de Napoles, Inodoro largo de Lyon) — los combos Lira y Belmond nunca salen en 3ª, aunque llevan un inodoro adentro (confirmado). `variante` es `''` (no `NULL`) cuando no aplica — importante: un `UNIQUE` sobre una columna nullable no funciona como upsert-key en Postgres porque `NULL != NULL`, así que un `ON CONFLICT` con variante `NULL` inserta duplicados en vez de actualizar (nos pasó, ver historial de `schema_piezas.sql`).

**Reglas de precio** (lista julio 2026, confirmadas por Víctor): `comercial` = precio de lista sin IVA tal cual; `1era` = precio de lista × 1.21 (+21% IVA); `3era` = precio de lista × 0.50. Administrar: editar `CATALOGO` en `scripts/setup-piezas.cjs` (con el precio base "comercial" por pieza) y correr el script — es un upsert, actualiza precios de las que ya existen y agrega las nuevas, no duplica ni borra.

**`factura_items`**: piezas vendidas en cada factura (`factura_id`, `pieza_id`, `cantidad`). Es lo que permite responder "¿cuántos inodoros cortos comercial le vendimos a tal cliente en tal mes?". Se borra en cascada si se borra la factura.

## Carga diaria de facturas (`/nueva-factura.html`)

Pensada para que el empleado de facturación o de ventas la use día a día:

1. Busca al cliente por nombre o CUIT (autocompleta contra `clientes`; si no lo encuentra, igual puede cargar la factura solo con el nombre escrito, sin vincular a un cliente existente).
2. Elige la **empresa que factura**: **Cerámica** o **Porcelanas** → se marca automáticamente como Factura A (facturado). **Presupuesto** → se marca automáticamente como Remito X (sin factura). El empleado no tiene que pensar en esa lógica, ya está resuelta por el radio button. (Nota: Cerámica y Porcelanas son dos sociedades/fábricas distintas que producen las mismas líneas de producto — no tiene relación con la calidad de la pieza.)
3. Completa fecha, N° de comprobante (opcional) e importe USD (opcional — si lo carga junto con el ARS, el tipo de cambio se calcula solo).
4. En "Piezas vendidas" (opcional) agrega una o más filas: elige línea de producto → pieza+calidad (el selector se filtra según la línea elegida) → cantidad. Se pueden agregar tantas filas como piezas distintas incluya la venta. **El importe ARS se calcula solo** sumando precio × cantidad de las piezas cargadas — el empleado no tiene que tipearlo a mano, aunque el campo sigue siendo editable por si hay que ajustarlo (descuento puntual, etc.). Si no carga ninguna pieza, el importe queda en blanco y hay que completarlo a mano como antes.
5. Al guardar, queda registrado quién lo cargó (`cargado_por`) y aparece al instante en la lista "Cargadas hoy" de la misma pantalla.

## Análisis de piezas (`/piezas.html`)

Filtra `factura_items` por cliente(s), línea, pieza+calidad y rango de fechas. Responde directamente preguntas tipo "¿cuántos inodoros cortos comercial compró tal cliente en julio?". Solo tiene datos para facturas cargadas desde `/nueva-factura.html` con piezas completadas — el import histórico de 1.615 facturas no tiene desglose por pieza.

- **0 o 1 cliente elegido**: tabla simple agrupada por cliente/pieza/calidad, con cantidad total y N° de facturas.
- **2 o 3 clientes elegidos** (el filtro de cliente admite selección múltiple, con chips removibles): cambia a una **tabla comparativa** — una fila por pieza+calidad, una columna por cada cliente elegido, para verlos lado a lado.

## Correr en local

```bash
npm install
npm run dev
# http://localhost:3000 (redirige a /login)
```

## Re-importar / re-crear datos

```bash
node scripts/import-data.cjs       # BORRA y reinserta toda la tabla clientes
node scripts/import-facturas.cjs   # BORRA y reinserta toda la tabla facturas (incluye las cargadas a mano — usar con cuidado)
node scripts/setup-usuarios.cjs    # crea/actualiza usuarios, no borra nada
```

## Envío de emails (Resend)

Cada cliente con email cargado tiene un botón **"✉ Enviar email"** en el dashboard (`public/index.html`). Al hacer clic:

1. Arma el asunto + cuerpo según el segmento del cliente (`EMAIL_TEMPLATES` en `app.js`, mismo criterio que los mensajes de WhatsApp).
2. Elige el remitente según el rol del usuario logueado (`ventas` → `ventas@...`, `facturacion`/`admin` → `administracion@...`).
3. Pide confirmación (`confirm()` del navegador) mostrando destinatario, asunto y remitente antes de mandar nada.
4. Llama a `/api/send-email`, que valida la sesión, valida que el remitente esté en la whitelist, y llama a la API de Resend server-side (la `RESEND_API_KEY` nunca se expone al navegador).

**Bloqueante actual**: el dominio `porcelanasalberti.com.ar` no está verificado en Resend, así que ningún envío real funciona todavía (se confirmó con un test real — Resend devuelve `403 domain not verified`). Falta: entrar a [resend.com/domains](https://resend.com/domains), agregar el dominio, y cargar los registros DNS que da Resend en el proveedor donde está contratado el dominio.

No hay envío masivo/bulk todavía — es un botón por cliente, a propósito, para no arriesgar mandar de más antes de tener el dominio verificado y probado con casos reales.

## Pendiente

- El análisis de piezas es solo hacia adelante: no hay forma de reconstruir qué piezas específicas componían las 1.615 facturas históricas importadas del Excel (esa planilla no tenía ese nivel de detalle).
- Verificar `porcelanasalberti.com.ar` en Resend (ver arriba) — sin esto, el botón de email no manda nada a clientes reales.
- Los segmentos A-E (312 clientes activos 2025-2026) tienen los campos de contacto vacíos a propósito — Worcer los tiene que exportar de su sistema de facturación y cargarlos acá.
- RLS real (con Supabase Auth) en `clientes` y `facturas` si se quiere cerrar el acceso directo a esas tablas también.
- Envío masivo/bulk por segmento, si hace falta una vez que el envío individual esté probado con el dominio verificado.
