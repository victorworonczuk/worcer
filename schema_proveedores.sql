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
-- Sumados al importar "Proveedores - Porcelanas Alberti.xlsx" (29/09/26):
-- telefono_2 (línea alternativa), direccion (calle/altura, separado de
-- localidad), condiciones (forma de pago habitual) y palabra_clave (qué le
-- compramos, en pocas palabras — para el buscador de artículos).
alter table public.proveedores add column if not exists telefono_2 text;
alter table public.proveedores add column if not exists direccion text;
alter table public.proveedores add column if not exists condiciones text;
alter table public.proveedores add column if not exists palabra_clave text;
-- A quién pedir cuando se llama — mismo campo/nombre que clientes.nombre_contacto.
alter table public.proveedores add column if not exists nombre_contacto text;

create table if not exists public.compras_proveedor (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores(id) on delete cascade,
  fecha date not null,
  cantidad numeric,
  descripcion text,
  monto numeric,
  created_at timestamptz not null default now(),
  cargado_por text
);
alter table public.compras_proveedor add column if not exists cantidad numeric;

create index if not exists idx_compras_proveedor_proveedor on public.compras_proveedor(proveedor_id);
create index if not exists idx_compras_proveedor_fecha on public.compras_proveedor(fecha);

-- Evita duplicar filas si se vuelve a subir el mismo "Solicitud de
-- Compra.xlsx" (o uno con filas superpuestas) por /api/import-compras-proveedor.
create unique index if not exists idx_compras_proveedor_fila_unica
  on public.compras_proveedor(proveedor_id, fecha, descripcion, monto);

alter table public.proveedores disable row level security;
alter table public.compras_proveedor disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.proveedores to anon, authenticated;
grant select, insert, update, delete on public.compras_proveedor to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
