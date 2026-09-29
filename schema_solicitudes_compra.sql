-- Reemplaza la planilla "Solicitud de Compra.xlsx": de acá en más el pedido
-- de compra se carga directo en el sistema, con estados reales en vez de
-- una columna "Estado" (OK/NO) más F.Compra presente o no para saber si ya
-- se compró. Cuando una solicitud pasa a 'comprado' se crea automáticamente
-- (o se vincula) el registro correspondiente en compras_proveedor, así el
-- historial de "qué le compramos a quién" en Proveedores queda al día solo.
create table if not exists public.solicitudes_compra (
  id bigint generated always as identity primary key,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'comprado', 'rechazado')),
  fecha_pedido date not null default current_date,
  cantidad numeric,
  descripcion text not null,
  proveedor_id bigint references public.proveedores(id),
  proveedor_sugerido text, -- nombre tal cual se escribió, por si todavía no se vinculó a un proveedor
  precio_unitario numeric,
  monto_total numeric,
  forma_pago text,
  fecha_necesidad date,
  numero_factura text,
  fecha_compra date,
  fecha_recepcion date,
  solicitante text,
  supervisa text,
  aprobado_por text,
  compra_proveedor_id bigint references public.compras_proveedor(id),
  created_at timestamptz not null default now(),
  cargado_por text
);

create index if not exists idx_solicitudes_compra_estado on public.solicitudes_compra(estado);
create index if not exists idx_solicitudes_compra_proveedor on public.solicitudes_compra(proveedor_id);
create index if not exists idx_solicitudes_compra_fecha on public.solicitudes_compra(fecha_pedido);

alter table public.solicitudes_compra disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.solicitudes_compra to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
