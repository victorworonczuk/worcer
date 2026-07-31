create table if not exists public.usuarios (
  id bigint generated always as identity primary key,
  username text unique not null,
  password_hash text not null,
  salt text not null,
  nombre text not null,
  rol text not null default 'empleado',
  created_at timestamptz not null default now()
);

-- IMPORTANTE: Supabase otorga privilegios por defecto a anon/authenticated sobre
-- tablas nuevas del schema public aunque no se los pidamos explícitamente. Para
-- esta tabla (tiene hashes de contraseñas) hace falta revocar explícitamente y
-- activar RLS, si no queda legible con la clave pública sb_publishable_*.
revoke all on public.usuarios from anon, authenticated, public;
alter table public.usuarios enable row level security;
alter table public.usuarios force row level security;

alter table public.facturas add column if not exists cargado_por text;

-- Quién editó por última vez un cliente y cuándo — se muestra como tooltip
-- al pasar el cursor sobre el nombre en el dashboard. No hay forma de
-- reconstruir esto para ediciones anteriores a que se agregaran estas
-- columnas, van a quedar en null hasta la próxima edición de cada cliente.
alter table public.clientes add column if not exists actualizado_por text;
alter table public.clientes add column if not exists actualizado_en timestamptz;
