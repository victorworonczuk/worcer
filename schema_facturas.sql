create table if not exists public.facturas (
  id bigint generated always as identity primary key,
  cuit_normalizado text,
  cuit_original text,
  nombre_facturado text,
  empresa text,
  fecha date,
  mes text,
  tipo_comprobante text,
  numero_comprobante text,
  importe_ars numeric,
  tipo_cambio numeric,
  importe_usd numeric,
  cliente_id bigint references public.clientes(id),
  created_at timestamptz not null default now(),
  -- Quién la cargó: username si la cargó un empleado a mano, 'import-ventas' si
  -- vino del importador automático del sistema de facturación, null si vino del
  -- import histórico inicial (ver import-facturas.cjs).
  cargado_por text,
  -- Vendedor asignado por el cruce contra pedidos_vendedor (ver
  -- lib/cotejarVendedor.js) o cargado a mano en un caso ambiguo.
  vendedor text,
  vendedor_fuente text check (vendedor_fuente in ('cotejo_automatico', 'manual'))
);

create index if not exists idx_facturas_cuit on public.facturas(cuit_normalizado);
create index if not exists idx_facturas_cliente on public.facturas(cliente_id);
create index if not exists idx_facturas_fecha on public.facturas(fecha);

-- Evita duplicar un comprobante si se re-sube el mismo reporte o uno con
-- fechas superpuestas: el número de comprobante es único dentro de cada
-- empresa + tipo (F A, NC A, etc). Los NULL (cargas manuales sin número real,
-- como remitos) no chocan entre sí — comportamiento estándar de Postgres.
create unique index if not exists idx_facturas_comprobante_unico
  on public.facturas(empresa, tipo_comprobante, numero_comprobante);

alter table public.facturas disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.facturas to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
