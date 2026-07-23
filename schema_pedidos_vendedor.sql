-- Módulo Pedidos por vendedor — cantidad y monto ($ARS) de pedidos por
-- vendedor y día, para medir desempeño. Se carga desde el "TABLERO PEDIDOS DE
-- VENTA" (Excel mensual) vía la pantalla "Cargar pedidos" (ver
-- lib/pedidosVendedorXlsx.js para el parseo y el mapeo de nombres de vendedor).

create table if not exists public.pedidos_vendedor (
  id          bigint generated always as identity primary key,
  vendedor    text not null,
  fecha       date not null,
  -- numeric (no integer): las filas combinadas del archivo de origen (ej. dos
  -- vendedores en una sola fila) se reparten en partes iguales.
  cantidad    numeric not null default 0,
  monto_ars   numeric not null default 0,
  cargado_por text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- una sola carga por vendedor + día; si se re-sube el archivo, se actualiza.
  unique (vendedor, fecha)
);

create index if not exists idx_pedidos_vendedor_fecha on public.pedidos_vendedor(fecha);
create index if not exists idx_pedidos_vendedor_vendedor on public.pedidos_vendedor(vendedor);

-- Permisos: mismo criterio que produccion (datos internos no sensibles).
alter table public.pedidos_vendedor disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.pedidos_vendedor to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
