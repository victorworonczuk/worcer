create table if not exists public.piezas (
  id bigint generated always as identity primary key,
  linea text not null,
  tipo_pieza text not null,
  -- '' (no NULL) cuando no aplica variante: NULL rompe el UNIQUE de abajo porque
  -- Postgres nunca considera dos NULL como iguales (el ON CONFLICT del seed
  -- generaba duplicados en vez de actualizar el precio). Ver setup-piezas.cjs.
  variante text not null default '',
  calidad text not null,
  precio_ars numeric,
  precio_actualizado timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (linea, tipo_pieza, variante, calidad)
);

create table if not exists public.factura_items (
  id bigint generated always as identity primary key,
  factura_id bigint not null references public.facturas(id) on delete cascade,
  pieza_id bigint not null references public.piezas(id),
  -- Puede ser negativa: una nota de crédito (devolución) resta piezas. Lo que
  -- no tiene sentido es 0 (ningún movimiento real).
  cantidad integer not null check (cantidad <> 0),
  -- Precio ARS de la pieza al momento de la venta (copiado de piezas.precio_ars
  -- al insertar). No se recalcula con el precio actual del catálogo, para que
  -- el monto histórico no cambie si más adelante actualizamos la lista de precios.
  precio_unitario numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_factura_items_factura on public.factura_items(factura_id);
create index if not exists idx_factura_items_pieza on public.factura_items(pieza_id);
create index if not exists idx_piezas_linea on public.piezas(linea);

-- Una factura no debería tener dos filas para la misma pieza (si el origen
-- trae dos renglones del mismo producto, se suman antes de insertar) — esto
-- permite que el importador de salidas de stock sea idempotente (upsert por
-- esta clave en vez de insertar de nuevo cada vez que se corre).
create unique index if not exists idx_factura_items_factura_pieza_unico
  on public.factura_items(factura_id, pieza_id);

alter table public.piezas disable row level security;
alter table public.factura_items disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.piezas to anon, authenticated;
grant select, insert, update, delete on public.factura_items to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
