-- Proveedores: ficha básica + historial de compras cargado a mano (no hay
-- todavía un reporte del sistema de facturación para esto, a diferencia de
-- ventas/facturas de clientes — se arranca vacío y se carga desde la pantalla).
create table if not exists public.proveedores (
  id bigint generated always as identity primary key,
  nombre text not null,
  cuit text,
  rubro text,
  telefono text,
  email text,
  localidad text,
  provincia text,
  created_at timestamptz not null default now(),
  cargado_por text
);

create table if not exists public.compras_proveedor (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores(id) on delete cascade,
  fecha date not null,
  descripcion text,
  monto numeric,
  created_at timestamptz not null default now(),
  cargado_por text
);

create index if not exists idx_compras_proveedor_proveedor on public.compras_proveedor(proveedor_id);
create index if not exists idx_compras_proveedor_fecha on public.compras_proveedor(fecha);

alter table public.proveedores disable row level security;
alter table public.compras_proveedor disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.proveedores to anon, authenticated;
grant select, insert, update, delete on public.compras_proveedor to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
