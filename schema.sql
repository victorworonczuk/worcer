create table if not exists public.clientes (
  id bigint generated always as identity primary key,
  cuit text,
  nombre text not null,
  nombre_fantasia text,
  provincia text,
  localidad text,
  domicilio text,
  origen text,
  segmento text,
  meses_sin_comprar int,
  ultima_compra date,
  usd_total_2025_2026 numeric,
  ars_total_2025_2026 numeric,
  meses_compra_2025_2026 int,
  lineas text,
  telefono text,
  whatsapp text,
  email text,
  web text,
  rubro text,
  descripcion text,
  confianza_dato text,
  fuente text,
  estado_contacto text not null default 'pendiente',
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clientes_segmento on public.clientes(segmento);
create index if not exists idx_clientes_provincia on public.clientes(provincia);
create index if not exists idx_clientes_estado_contacto on public.clientes(estado_contacto);
create index if not exists idx_clientes_cuit on public.clientes(cuit);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
  before update on public.clientes
  for each row
  execute function public.set_updated_at();

-- Uso interno sin login: RLS desactivado y permisos abiertos para anon/authenticated.
alter table public.clientes disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.clientes to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
