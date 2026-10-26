-- À exécuter dans l'éditeur SQL du projet Supabase.
create table if not exists public.orders (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  total_cents integer not null check(total_cents >= 0),
  currency text not null default 'eur',
  payload jsonb not null default '{}'::jsonb,
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists orders_user_id_idx on public.orders (user_id, created_at desc);
create index if not exists orders_email_idx on public.orders (email);
alter table public.orders enable row level security;
-- La lecture des commandes liées au compte est autorisée aux seuls propriétaires.
-- L'écriture s'effectue uniquement depuis le serveur avec la clé service_role.
drop policy if exists "Customers view their own orders" on public.orders;
create policy "Customers view their own orders"
on public.orders for select to authenticated
using (user_id = (select auth.uid()));
