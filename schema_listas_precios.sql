-- Lista de precios vigente (una sola lista activa por vez — Worcer dejó de
-- diferenciar precio por calidad, solo vende "Primera" a precio de lista;
-- lo de calidad comercial/segunda se vende mayormente sin factura, así que
-- no tiene un precio de lista formal).
create table if not exists public.listas_precios (
  id bigint generated always as identity primary key,
  fecha_vigencia date not null,
  tipo_cambio numeric,
  nota text,
  created_at timestamptz not null default now()
);

-- Precio por pieza (siempre calidad '1era' en la práctica, ver nota arriba).
create table if not exists public.lista_precios_items (
  id bigint generated always as identity primary key,
  lista_id bigint not null references public.listas_precios(id) on delete cascade,
  pieza_id bigint not null references public.piezas(id),
  precio_sin_iva numeric not null,
  unique (lista_id, pieza_id)
);

-- Descuento por escala de monto de la factura (ej: 0-650k = 25%, etc.) +
-- plazo de pago asociado a cada escala.
create table if not exists public.lista_precios_descuentos (
  id bigint generated always as identity primary key,
  lista_id bigint not null references public.listas_precios(id) on delete cascade,
  monto_desde numeric not null,
  monto_hasta numeric, -- null = sin techo
  descuento numeric not null, -- 0.25 = 25%
  plazo_pago text
);

create index if not exists idx_lista_precios_items_lista on public.lista_precios_items(lista_id);
create index if not exists idx_lista_precios_descuentos_lista on public.lista_precios_descuentos(lista_id);

alter table public.listas_precios disable row level security;
alter table public.lista_precios_items disable row level security;
alter table public.lista_precios_descuentos disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.listas_precios to anon, authenticated;
grant select, insert, update, delete on public.lista_precios_items to anon, authenticated;
grant select, insert, update, delete on public.lista_precios_descuentos to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
