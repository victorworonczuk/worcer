-- Módulo Producción — registro diario de producción / venta / rotura por pieza y calidad.
-- Comparte el catálogo public.piezas con el módulo de ventas (factura_items),
-- para poder cruzar producción vs venta facturada por la misma pieza.

create table if not exists public.produccion (
  id          bigint generated always as identity primary key,
  fecha       date not null,
  -- pieza_id apunta al catálogo (linea/tipo_pieza/variante/calidad): la calidad
  -- ya está codificada en la pieza, por eso la carga "por calidad" no necesita
  -- una columna calidad aparte.
  pieza_id    bigint not null references public.piezas(id),
  -- Worcer tiene dos depósitos físicos: Alberti (fábrica + depósito madre,
  -- se alimenta de producción propia) y Lanús Oeste (depósito secundario,
  -- se alimenta solo por traslado en expreso desde Alberti). El stock se
  -- calcula por separado por ubicación, y el total unificado sale de sumar
  -- ambas — ver renderStock() en produccion.js.
  ubicacion   text not null default 'alberti' check (ubicacion in ('alberti', 'lanus')),
  -- Tipos de movimiento:
  --   produccion       (+) piezas fabricadas (siempre en Alberti)
  --   venta            (-) piezas vendidas/despachadas
  --   rotura           (-) rotura en fábrica / línea de producción
  --   rotura_deposito  (-) rotura en el depósito (manipuleo / guardado)
  --   traslado_salida  (-) sale de esta ubicación rumbo al otro depósito
  --   traslado_entrada (+) llega a esta ubicación desde el otro depósito
  --                        (par atómico con traslado_salida, mismo día/pieza,
  --                        cantidad igual, ubicacion distinta — ver traslado.js)
  --   recuento         (=) conteo físico: FIJA el stock a esa fecha (ancla).
  --                        El "stock inicial" es simplemente el primer recuento.
  --                        Es por ubicación: cada depósito tiene su propio ancla.
  tipo        text not null check (tipo in ('produccion', 'venta', 'rotura', 'rotura_deposito', 'recuento', 'traslado_salida', 'traslado_entrada')),
  cantidad    integer not null check (cantidad >= 0),
  cargado_por text,
  created_at  timestamptz not null default now(),
  -- una sola carga por día + pieza(+calidad) + tipo + ubicación; si se re-carga, se actualiza.
  unique (fecha, pieza_id, tipo, ubicacion)
);

create index if not exists idx_produccion_fecha on public.produccion(fecha);
create index if not exists idx_produccion_pieza on public.produccion(pieza_id);
create index if not exists idx_produccion_tipo  on public.produccion(tipo);
create index if not exists idx_produccion_ubicacion on public.produccion(ubicacion);

-- Permisos: misma política que piezas / factura_items (datos internos no sensibles).
-- (Ver nota de seguridad del README: Supabase otorga privilegios por defecto; los
--  hacemos explícitos igual que en las otras tablas del módulo.)
alter table public.produccion disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.produccion to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Migración: soporte para dos depósitos (Alberti / Lanús Oeste) — todo lo
-- cargado antes de esto era Alberti (único depósito hasta ahora), por eso
-- el default y el backfill van a 'alberti'.
alter table public.produccion add column if not exists ubicacion text not null default 'alberti' check (ubicacion in ('alberti', 'lanus'));

alter table public.produccion drop constraint if exists produccion_tipo_check;
alter table public.produccion add constraint produccion_tipo_check
  check (tipo in ('produccion', 'venta', 'rotura', 'rotura_deposito', 'recuento', 'traslado_salida', 'traslado_entrada'));

alter table public.produccion drop constraint if exists produccion_fecha_pieza_id_tipo_key;
alter table public.produccion add constraint produccion_fecha_pieza_id_tipo_ubicacion_key
  unique (fecha, pieza_id, tipo, ubicacion);

create index if not exists idx_produccion_ubicacion on public.produccion(ubicacion);
