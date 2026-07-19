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
  -- Tipos de movimiento:
  --   produccion       (+) piezas fabricadas
  --   venta            (-) piezas vendidas/despachadas
  --   rotura           (-) rotura en fábrica / línea de producción
  --   rotura_deposito  (-) rotura en el depósito (manipuleo / guardado)
  --   recuento         (=) conteo físico: FIJA el stock a esa fecha (ancla).
  --                        El "stock inicial" es simplemente el primer recuento.
  tipo        text not null check (tipo in ('produccion', 'venta', 'rotura', 'rotura_deposito', 'recuento')),
  cantidad    integer not null check (cantidad >= 0),
  cargado_por text,
  created_at  timestamptz not null default now(),
  -- una sola carga por día + pieza(+calidad) + tipo; si se re-carga, se actualiza.
  unique (fecha, pieza_id, tipo)
);

create index if not exists idx_produccion_fecha on public.produccion(fecha);
create index if not exists idx_produccion_pieza on public.produccion(pieza_id);
create index if not exists idx_produccion_tipo  on public.produccion(tipo);

-- Permisos: misma política que piezas / factura_items (datos internos no sensibles).
-- (Ver nota de seguridad del README: Supabase otorga privilegios por defecto; los
--  hacemos explícitos igual que en las otras tablas del módulo.)
alter table public.produccion disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.produccion to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
