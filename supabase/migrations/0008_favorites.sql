-- Phase 5: favorites.
--
-- Run this in the Supabase SQL Editor, same as the earlier migrations.
-- Idempotent / safe to re-run.
--
-- Unlike every other write path in this app, favorites are plain
-- self-managed rows: a user can only ever see/insert/delete rows where
-- user_id = auth.uid(), so a direct RLS policy is safe here without needing
-- a SECURITY DEFINER RPC in front of it.

create table if not exists public.favorites (
    user_id uuid not null references auth.users (id) on delete cascade,
    favorite_user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, favorite_user_id)
);

alter table public.favorites enable row level security;

drop policy if exists "favorites are self-managed" on public.favorites;
create policy "favorites are self-managed" on public.favorites
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, delete on public.favorites to authenticated;
