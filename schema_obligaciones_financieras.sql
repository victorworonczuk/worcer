-- Obligaciones financieras mensuales (cuota de préstamos + ARCA) — costo fijo
-- para el cálculo de punto de equilibrio. Cargado desde "Detalle préstamos y
-- ARCA.xlsx", hoja "Consolidado general" (resumen ya armado por Víctor, no se
-- modela acá el detalle de cada préstamo individual ni las obligaciones ARCA
-- una por una — eso queda en su control de deuda, no es parte del CRM).
-- Incluye meses futuros (proyección de lo ya tomado, no compromisos nuevos).
create table if not exists public.obligaciones_financieras (
  id bigint generated always as identity primary key,
  anio integer not null,
  mes integer not null check (mes between 1 and 12),
  prestamos numeric not null,
  arca numeric not null,
  created_at timestamptz not null default now(),
  unique (anio, mes)
);

alter table public.obligaciones_financieras disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.obligaciones_financieras to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
