-- Costo total unitario (CTU) por pieza, para calcular margen (venta real -
-- costo) y punto de equilibrio. Cargado desde "06.COSTOS.xlsx" (hoja "Costos
-- fijos" para piezas fabricadas, hoja "Importados" para Lira/Belmond que se
-- compran hechas). El costo de fabricación no varía por calidad (1era/
-- comercial/3era es una clasificación de venta, no de costo), así que el
-- mismo CTU se aplica a todas las calidades de una misma pieza.
create table if not exists public.costos_piezas (
  id bigint generated always as identity primary key,
  pieza_id bigint not null references public.piezas(id) unique,
  ctu_usd numeric,
  ctu_ars numeric,
  fecha_actualizacion date not null,
  created_at timestamptz not null default now()
);

-- Gastos generales mensuales por empresa (alquiler, sueldos, servicios, etc.
-- — no incluye préstamos/ARCA, eso está en obligaciones_financieras). Cargado
-- desde "06.COSTOS.xlsx", hoja "RESULTADO".
create table if not exists public.gastos_generales_mensuales (
  id bigint generated always as identity primary key,
  anio integer not null,
  mes integer not null check (mes between 1 and 12),
  empresa text not null,
  monto numeric not null,
  created_at timestamptz not null default now(),
  unique (anio, mes, empresa)
);

alter table public.costos_piezas disable row level security;
alter table public.gastos_generales_mensuales disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.costos_piezas to anon, authenticated;
grant select, insert, update, delete on public.gastos_generales_mensuales to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
