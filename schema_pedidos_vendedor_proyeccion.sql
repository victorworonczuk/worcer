-- Proyección de cierre de mes por vendedor, tal como la calcula el propio
-- "Tablero de pedidos de venta" (columna "Proyectado" a la derecha de cada
-- bloque: (total acumulado / días hábiles transcurridos) * días hábiles del
-- mes). Se toma el valor ya calculado por el Excel en vez de reimplementar la
-- fórmula acá, para no arriesgarse a que un ajuste manual en el archivo de
-- origen quede sin reflejar.

create table if not exists public.pedidos_vendedor_proyeccion (
  id                  bigint generated always as identity primary key,
  vendedor            text not null,
  mes                 text not null, -- 'AAAA-MM'
  proyectado_cantidad numeric,
  proyectado_monto    numeric,
  cargado_por         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (vendedor, mes)
);

create index if not exists idx_pedidos_vendedor_proyeccion_mes on public.pedidos_vendedor_proyeccion(mes);

alter table public.pedidos_vendedor_proyeccion disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.pedidos_vendedor_proyeccion to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
