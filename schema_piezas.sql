create table if not exists public.piezas (
  id bigint generated always as identity primary key,
  linea text not null,
  tipo_pieza text not null,
  variante text,
  calidad text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (linea, tipo_pieza, variante, calidad)
);

create table if not exists public.factura_items (
  id bigint generated always as identity primary key,
  factura_id bigint not null references public.facturas(id) on delete cascade,
  pieza_id bigint not null references public.piezas(id),
  cantidad integer not null check (cantidad > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_factura_items_factura on public.factura_items(factura_id);
create index if not exists idx_factura_items_pieza on public.factura_items(pieza_id);
create index if not exists idx_piezas_linea on public.piezas(linea);

alter table public.piezas disable row level security;
alter table public.factura_items disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.piezas to anon, authenticated;
grant select, insert, update, delete on public.factura_items to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
