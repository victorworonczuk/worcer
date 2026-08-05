-- Tipo de cambio USD/ARS cargado a mano, una vez por mes (ver charla con
-- Víctor 2026-08-03 y 2026-08-05). Se usa para completar importe_usd de las
-- facturas que entran por "Importar ventas" (el importador automático de
-- XML nunca calculó el valor en dólares, a diferencia de la carga histórica
-- y de "Cargar factura" a mano — ver public/assets/import-ventas.js /
-- nueva-factura.js).
create table if not exists public.tipo_cambio (
  id bigint generated always as identity primary key,
  -- Primer día del mes (ej. 2026-07-01) — un solo valor por mes.
  mes date not null unique,
  valor numeric not null check (valor > 0),
  cargado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tipo_cambio_updated_at
  before update on public.tipo_cambio
  for each row execute function set_updated_at();

alter table public.tipo_cambio disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tipo_cambio to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
