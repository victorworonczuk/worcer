-- Pares de clientes que la alarma de "posibles duplicados sin ventas" (Clientes,
-- ver public/assets/app.js) marcó como parecidos por nombre, pero que Víctor ya
-- revisó y confirmó que son negocios/personas distintas (pedido 29/09/26: "las
-- demas aclaraciones te las dije para sacar la alerta del crm y ya tener ese
-- tema solucionado"). Sin esto, la detección por nombre los iba a seguir
-- marcando cada vez que se entra a la pantalla.
create table if not exists public.duplicados_ignorados (
  id bigint generated always as identity primary key,
  cliente_id_menor bigint not null references public.clientes(id) on delete cascade,
  cliente_id_mayor bigint not null references public.clientes(id) on delete cascade,
  created_at timestamptz not null default now(),
  ignorado_por text,
  unique (cliente_id_menor, cliente_id_mayor)
);

alter table public.duplicados_ignorados disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.duplicados_ignorados to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
