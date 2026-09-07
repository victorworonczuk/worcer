-- Libro de caja diario ("Caja 2026.xlsx" — una hoja por mes: Enero, Febrero,
-- ...). Cada fila es un movimiento (cobranza, gasto, comisión, sueldo, etc.)
-- con su saldo acumulado tal cual viene en la planilla de origen — no se
-- recalcula acá, se confía en el saldo que trae el archivo.
create table if not exists public.caja (
  id bigint generated always as identity primary key,
  fecha date not null,
  -- Categoría del movimiento (Cobranza, Gastos Industriales, Comisiones
  -- Vendedores, Adelanto de sueldo, etc.) — 'Saldo inicial' para la fila que
  -- abre cada mes en la planilla.
  cuenta text not null default '',
  detalle text not null default '',
  entrada numeric not null default 0,
  salida numeric not null default 0,
  saldo numeric,
  es_saldo_inicial boolean not null default false,
  created_at timestamptz not null default now(),
  cargado_por text
);

create index if not exists idx_caja_fecha on public.caja(fecha);
create index if not exists idx_caja_cuenta on public.caja(cuenta);

-- Evita duplicar filas si se re-sube el mismo mes (o un archivo con fechas
-- superpuestas): no hay un ID propio en el origen, así que la combinación
-- completa de la fila (que incluye el saldo acumulado, que por ser corrido
-- es distinto para cada posición real) funciona como clave natural.
create unique index if not exists idx_caja_fila_unica
  on public.caja(fecha, cuenta, detalle, entrada, salida, saldo);

alter table public.caja disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.caja to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
