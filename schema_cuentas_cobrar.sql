-- "Cuentas a cobrar.xlsx" — facturas emitidas pendientes de cobro (hoja
-- "2026") y clientes morosos históricos (hoja "Morosos", mismas columnas) en
-- una sola tabla, distinguidos por `origen`. La combinación (empresa,
-- numero_factura) es la clave natural — si el mismo comprobante apareciera
-- en las dos hojas, gana el que se cargó primero (no debería pasar: son
-- rangos de fecha disjuntos en la práctica).
create table if not exists public.cuentas_cobrar (
  id bigint generated always as identity primary key,
  empresa text,
  fecha_emision date,
  numero_factura text,
  cliente_nombre text not null default '', -- tal cual viene en la planilla
  cliente_id bigint references public.clientes(id), -- null si no se pudo vincular con confianza
  monto numeric,
  fecha_entrega date,
  fecha_estimada_pago date,
  vendedor text,
  origen text not null default 'pendiente' check (origen in ('pendiente', 'moroso')),
  created_at timestamptz not null default now(),
  cargado_por text
);

create index if not exists idx_cuentas_cobrar_cliente on public.cuentas_cobrar(cliente_id);
create index if not exists idx_cuentas_cobrar_fecha_pago on public.cuentas_cobrar(fecha_estimada_pago);
create unique index if not exists idx_cuentas_cobrar_factura_unica
  on public.cuentas_cobrar(empresa, numero_factura);

-- "Cheques rechazados" — cheques que rebotaron, con seguimiento de recupero.
create table if not exists public.cheques_rechazados (
  id bigint generated always as identity primary key,
  empresa text,
  fecha_nd date, -- fecha de la Nota de Débito por el cheque rechazado
  numero_nd text,
  cliente_nombre text not null default '',
  cliente_id bigint references public.clientes(id),
  monto_debido numeric,
  monto_recuperado numeric,
  saldo numeric,
  numero_cheque text,
  tipo_cheque text,
  estado text,
  fecha_recupero date,
  vendedor text,
  created_at timestamptz not null default now(),
  cargado_por text
);

create index if not exists idx_cheques_rechazados_cliente on public.cheques_rechazados(cliente_id);
create unique index if not exists idx_cheques_rechazados_nd_unica
  on public.cheques_rechazados(empresa, numero_nd);

alter table public.cuentas_cobrar disable row level security;
alter table public.cheques_rechazados disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.cuentas_cobrar to anon, authenticated;
grant select, insert, update, delete on public.cheques_rechazados to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
