create table if not exists public.facturas (
  id bigint generated always as identity primary key,
  cuit_normalizado text,
  cuit_original text,
  nombre_facturado text,
  empresa text,
  fecha date,
  mes text,
  tipo_comprobante text,
  numero_comprobante text,
  importe_ars numeric,
  tipo_cambio numeric,
  importe_usd numeric,
  cliente_id bigint references public.clientes(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_facturas_cuit on public.facturas(cuit_normalizado);
create index if not exists idx_facturas_cliente on public.facturas(cliente_id);
create index if not exists idx_facturas_fecha on public.facturas(fecha);

alter table public.facturas disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.facturas to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
