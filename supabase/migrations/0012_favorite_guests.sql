-- Phase 7 follow-up: favorites no longer work for signed-out visitors (the
-- localStorage fallback is removed client-side - see favorites.js), and can
-- now target a still-unclaimed guest identity (by guest_key) in addition to
-- a real account. When a favorited guest later gets merged into a real
-- account, the favorite carries over automatically instead of being lost.
--
-- Run this in the Supabase SQL Editor, after 0011.

-- ============================================================================
-- favorites: allow a row to reference either a real account
-- (favorite_user_id) or an unclaimed guest identity (favorite_guest_key),
-- never both/neither.
-- ============================================================================

alter table public.favorites drop constraint if exists favorites_pkey;
alter table public.favorites alter column favorite_user_id drop not null;
alter table public.favorites add column if not exists favorite_guest_key text;

alter table public.favorites add column if not exists id uuid default gen_random_uuid();
update public.favorites set id = gen_random_uuid() where id is null;
alter table public.favorites alter column id set not null;
alter table public.favorites add primary key (id);

alter table public.favorites drop constraint if exists favorites_target_check;
alter table public.favorites add constraint favorites_target_check
    check ((favorite_user_id is not null) <> (favorite_guest_key is not null));

-- Defense in depth: the UI never lets you favorite yourself (you always
-- appear pinned on the left instead), but a guest merge could otherwise
-- create exactly that - you favorited a guest who turns out to be your own
-- account under a different identity. admin_merge_guest_key below already
-- avoids creating this case, but block it at the schema level too.
alter table public.favorites drop constraint if exists favorites_no_self_favorite;
alter table public.favorites add constraint favorites_no_self_favorite
    check (favorite_user_id is null or favorite_user_id <> user_id);

create unique index if not exists favorites_user_favorite_user_unique
    on public.favorites (user_id, favorite_user_id)
    where favorite_user_id is not null;

create unique index if not exists favorites_user_favorite_guest_unique
    on public.favorites (user_id, favorite_guest_key)
    where favorite_guest_key is not null;

-- ============================================================================
-- admin_merge_guest_key: also carry over any favorites of this guest_key to
-- favorite the now-real account instead, once merged. If a user already
-- separately favorited that same real account (e.g. it already existed
-- independently of this guest identity), the redundant guest-based favorite
-- is just dropped rather than colliding with their existing one.
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
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

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
-- guest_claim_requests: let a user cancel their own still-pending request -
-- this is the Profile page's "cancel my merge suggestion" action. Only
-- pending requests can be cancelled this way; once resolved (approved or
-- rejected), the row is just history.
-- ============================================================================

drop policy if exists "users can cancel their own pending guest claim" on public.guest_claim_requests;
create policy "users can cancel their own pending guest claim" on public.guest_claim_requests
    for delete using (auth.uid() = requested_by_user_id and status = 'pending');

grant delete on public.guest_claim_requests to authenticated;

-- ============================================================================
-- A user can only ever complete one self-serve merge. Once merged, they
-- already have at least one entry_mode = 'fixed_rank' entry under their own
-- user_id (the only way that combination can exist - live entries are
-- always 'live', and a fixed_rank entry only ever gets a real user_id via
-- admin_merge_guest_key). A second self-serve request being approved by
-- mistake would silently wipe an already-correct entry (admin_merge_guest_key
-- treats the target's existing entry as stray test data and overwrites it) -
-- one careless admin click away from destroying a real record. This
-- replaces the original 0009 insert policy to add that guard; further
-- merges past the first one have to go through the admin's manual merge
-- tool directly (admin_merge_guest_key isn't restricted - only the
-- self-serve request path is).
-- ============================================================================

drop policy if exists "users can request their own guest claim" on public.guest_claim_requests;
create policy "users can request their own guest claim" on public.guest_claim_requests
    for insert with check (
        auth.uid() = requested_by_user_id
        and not exists (
            select 1 from public.entries e
            where e.user_id = requested_by_user_id and e.entry_mode = 'fixed_rank'
        )
    );
