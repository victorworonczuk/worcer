create table if not exists public.interacciones (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references public.clientes(id) on delete cascade,
  usuario text not null,
  canal text not null,
  resultado text not null,
  nota text,
  -- Fecha en que hay que volver a contactar (opcional). La interacción más
  -- reciente de cada cliente define su "próximo seguimiento" vigente.
  proximo_seguimiento date,
  created_at timestamptz not null default now()
);

create index if not exists idx_interacciones_cliente on public.interacciones(cliente_id);
create index if not exists idx_interacciones_created on public.interacciones(created_at);

-- Igual que clientes/facturas/piezas: uso interno, sin RLS, acceso abierto
-- vía la clave pública (protegido por el login del sitio, no por la base).
alter table public.interacciones disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.interacciones to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
