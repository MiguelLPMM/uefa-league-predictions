-- Phase 7 follow-up: separates a real account's actual login name from the
-- "display name" shown across the app.
--
-- - A guest (no-account) entry only ever has a display name (guest_display_name
--   on entries) - there's no login, so no "real name" to speak of.
-- - A real account gets both: `name` (their Google login name, set once at
--   signup and never changed automatically) and `display_name` (what's shown
--   everywhere - leaderboard, drilldown, etc). Before any merge, display_name
--   just equals name.
-- - The moment an account is merged with a guest identity (self-serve
--   approval or the admin's manual tool - both funnel through
--   admin_merge_guest_key), display_name is overwritten to that guest's
--   display name, so the leaderboard keeps showing "Montes" instead of
--   suddenly switching to "Miguel Montes" post-merge. `name` is untouched,
--   so the admin (or a future feature) can always get back to who they
--   really are.
-- - An admin can directly rename either kind of identity going forward
--   (admin_rename_profile for a real account, admin_rename_guest for a
--   still-unclaimed guest) - e.g. fixing a typo, or giving a guest who'll
--   never be merged a nicer display name.
--
-- This is forward-compatible with every guest already imported before this
-- migration: admin_merge_guest_key is the one function every merge path
-- (self-serve or manual) has always called, so updating it here means any
-- future merge of an already-imported guest_key correctly inherits that
-- guest's display name, no backfill of guest data needed.
--
-- Run this in the Supabase SQL Editor, after 0012.

-- ============================================================================
-- profiles: add `name` (the real login name) alongside the existing
-- `display_name` (what's shown). Backfill from display_name, which up to now
-- has always held the real name for every existing account (no merge has
-- ever touched it before this migration).
-- ============================================================================

alter table public.profiles add column if not exists name text;
update public.profiles set name = display_name where name is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text;
begin
    v_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email);
    insert into public.profiles (id, name, display_name, avatar_url)
    values (new.id, v_name, v_name, new.raw_user_meta_data ->> 'avatar_url')
    on conflict (id) do nothing;
    return new;
end;
$$;

-- ============================================================================
-- admin_merge_guest_key: same behavior as 0012's version (overwrite any
-- conflicting entry, carry over favorites), plus: inherit the guest's
-- display name onto the now-linked account.
-- ============================================================================

create or replace function public.admin_merge_guest_key(
    p_guest_key text,
    p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry record;
    v_merged_count int := 0;
    v_overwritten jsonb := '[]'::jsonb;
    v_guest_display_name text;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

    -- Captured before the loop below reassigns user_id on these rows (which
    -- would otherwise make them invisible to a "guest_key = ... and user_id
    -- is null" lookup afterward).
    select guest_display_name into v_guest_display_name
    from public.entries
    where guest_key = p_guest_key and user_id is null
    limit 1;

    for v_entry in
        select id, competition, season_year
        from public.entries
        where guest_key = p_guest_key and user_id is null
    loop
        if exists (
            select 1 from public.entries
            where user_id = p_user_id and competition = v_entry.competition and season_year = v_entry.season_year
        ) then
            delete from public.match_predictions
            where user_id = p_user_id and competition = v_entry.competition and season_year = v_entry.season_year;

            delete from public.entries
            where user_id = p_user_id and competition = v_entry.competition and season_year = v_entry.season_year;

            v_overwritten := v_overwritten || jsonb_build_object('competition', v_entry.competition, 'season_year', v_entry.season_year);
        end if;

        update public.entries set user_id = p_user_id where id = v_entry.id;
        v_merged_count := v_merged_count + 1;
    end loop;

    if v_merged_count = 0 then
        raise exception 'No unclaimed entries found for that guest key';
    end if;

    if v_guest_display_name is not null then
        update public.profiles set display_name = v_guest_display_name where id = p_user_id;
    end if;

    update public.guest_claim_requests
    set status = 'rejected', resolved_at = now()
    where guest_key = p_guest_key and status = 'pending';

    -- Carry over favorites of the guest identity to the now-real account,
    -- unless the favoriter already separately favorited that account, or
    -- the favoriter turns out to BE the person being merged (you favorited
    -- a guest who was your own account under a different identity this
    -- whole time - can't favorite yourself, so this one just gets dropped
    -- like the other two skip cases below rather than converted).
    update public.favorites
    set favorite_user_id = p_user_id, favorite_guest_key = null
    where favorite_guest_key = p_guest_key
        and user_id <> p_user_id
        and not exists (
            select 1 from public.favorites f2
            where f2.user_id = favorites.user_id and f2.favorite_user_id = p_user_id
        );

    delete from public.favorites where favorite_guest_key = p_guest_key;

    return jsonb_build_object('merged', v_merged_count, 'overwritten', v_overwritten);
end;
$$;

grant execute on function public.admin_merge_guest_key(text, uuid) to authenticated;

-- ============================================================================
-- Admin-only display-name editing, for both kinds of identity. Separate from
-- the merge flow above - this is for a typo fix, or giving a guest who'll
-- never be claimed a cleaner name, at any time.
-- ============================================================================

create or replace function public.admin_rename_profile(
    p_user_id uuid,
    p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'Display name is required';
    end if;

    update public.profiles set display_name = trim(p_display_name) where id = p_user_id;
end;
$$;

grant execute on function public.admin_rename_profile(uuid, text) to authenticated;

create or replace function public.admin_rename_guest(
    p_guest_key text,
    p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'Display name is required';
    end if;

    update public.entries set guest_display_name = trim(p_display_name)
    where guest_key = p_guest_key and user_id is null;
end;
$$;

grant execute on function public.admin_rename_guest(text, text) to authenticated;
