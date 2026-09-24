-- History charts: a stable colour per person.
--
-- The 12 chart colours are a fixed palette (in public/js/historyChart.js); this only stores
-- WHICH one each identity has, so a person keeps the same colour in every competition/chart:
--   * an account: profiles.chart_color, assigned when the profile is created
--   * an unclaimed guest: entries.guest_color, shared by every row of that guest_key
-- next_chart_color() picks the least-used palette index (lowest index on ties), so nobody
-- repeats a colour until more than 12 people exist. When a guest is merged into an account,
-- the account takes over the guest's colour (just as it takes over the display name).
-- Existing accounts and guests are given colours below, oldest first.
--
-- Run this in the Supabase SQL Editor, after 0013. Safe to re-run.

alter table public.profiles add column if not exists chart_color smallint;
alter table public.entries add column if not exists guest_color smallint;

alter table public.profiles drop constraint if exists profiles_chart_color_range;
alter table public.profiles add constraint profiles_chart_color_range
    check (chart_color is null or chart_color between 0 and 11);
alter table public.entries drop constraint if exists entries_guest_color_range;
alter table public.entries add constraint entries_guest_color_range
    check (guest_color is null or guest_color between 0 and 11);

create or replace function public.next_chart_color()
returns smallint
language sql
stable
set search_path = public
as $$
    with used as (
        select chart_color as c from public.profiles where chart_color is not null
        union all
        select guest_color as c from (
            select distinct on (guest_key) guest_key, guest_color
            from public.entries
            where user_id is null and guest_color is not null
            order by guest_key
        ) g
    ),
    palette as (select generate_series(0, 11) as c)
    select p.c::smallint
    from palette p
    left join (select c, count(*) as n from used group by c) u on u.c = p.c
    order by coalesce(u.n, 0), p.c
    limit 1;
$$;

-- only ever called from the security-definer functions below
revoke execute on function public.next_chart_color() from public, anon, authenticated;

-- give everyone who exists already a colour, oldest first (each pick sees the earlier ones)
do $$
declare
    r record;
begin
    for r in select id from public.profiles where chart_color is null order by created_at, id
    loop
        update public.profiles set chart_color = public.next_chart_color() where id = r.id;
    end loop;

    for r in
        select guest_key from public.entries
        where user_id is null and guest_key is not null
        group by guest_key
        having bool_or(guest_color is null)
        order by min(submitted_at), guest_key
    loop
        update public.entries
        set guest_color = coalesce(
            (select e2.guest_color from public.entries e2
              where e2.guest_key = r.guest_key and e2.user_id is null and e2.guest_color is not null limit 1),
            public.next_chart_color())
        where user_id is null and guest_key = r.guest_key and guest_color is null;
    end loop;
end
$$;

-- new accounts get a colour (0013's version + chart_color)
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
    insert into public.profiles (id, name, display_name, avatar_url, chart_color)
    values (new.id, v_name, v_name, new.raw_user_meta_data ->> 'avatar_url', public.next_chart_color())
    on conflict (id) do nothing;
    return new;
end;
$$;

-- a guest's first entry picks a colour; later entries (any competition/season) reuse it
-- (0010's version + guest_color)
create or replace function public.admin_import_guest_entry(
    p_guest_key text,
    p_display_name text,
    p_competition text,
    p_season_year int,
    p_rankings jsonb, -- array of { team_id text, team_name text, team_logo_url text, predicted_rank int }
    p_is_late boolean,
    p_late_weeks int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry_id uuid;
    v_color smallint;
    r jsonb;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    if p_competition not in ('ucl', 'uel', 'uecl') then
        raise exception 'Unknown competition: %', p_competition;
    end if;
    if p_guest_key is null or p_guest_key !~ '^[a-z0-9_-]+$' then
        raise exception 'Guest key must be lowercase letters/numbers/hyphens/underscores only';
    end if;
    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'Display name is required';
    end if;

    select id into v_entry_id
    from public.entries
    where user_id is null
        and guest_key = p_guest_key
        and competition = p_competition
        and season_year = p_season_year;

    if v_entry_id is null then
        -- one colour per guest identity: reuse the one this guest already has, else the next free one
        select guest_color into v_color from public.entries
        where user_id is null and guest_key = p_guest_key and guest_color is not null
        limit 1;
        v_color := coalesce(v_color, public.next_chart_color());

        insert into public.entries (user_id, guest_key, guest_display_name, competition, season_year, entry_mode, is_late, late_weeks, submitted_at, guest_color)
        values (null, p_guest_key, p_display_name, p_competition, p_season_year, 'fixed_rank', coalesce(p_is_late, false), coalesce(p_late_weeks, 0), now(), v_color)
        returning id into v_entry_id;
    else
        update public.entries
        set guest_display_name = p_display_name,
            is_late = coalesce(p_is_late, false),
            late_weeks = coalesce(p_late_weeks, 0)
        where id = v_entry_id;

        delete from public.fixed_rank_predictions where entry_id = v_entry_id;
    end if;

    for r in select * from jsonb_array_elements(p_rankings)
    loop
        insert into public.fixed_rank_predictions (entry_id, team_id, team_name, team_logo_url, predicted_rank)
        values (
            v_entry_id,
            coalesce(nullif(r ->> 'team_id', ''), r ->> 'team_name'),
            r ->> 'team_name',
            nullif(r ->> 'team_logo_url', ''),
            (r ->> 'predicted_rank')::int
        );
    end loop;

    return v_entry_id;
end;
$$;

grant execute on function public.admin_import_guest_entry(text, text, text, int, jsonb, boolean, int) to authenticated;

-- a merge hands the guest's colour to the account (0013's version + colour)
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
    v_guest_color smallint;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

    -- Captured before the loop below reassigns user_id on these rows (which
    -- would otherwise make them invisible to a "guest_key = ... and user_id
    -- is null" lookup afterward).
    select guest_display_name, guest_color into v_guest_display_name, v_guest_color
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
    -- the person keeps the colour everyone already knew them by
    if v_guest_color is not null then
        update public.profiles set chart_color = v_guest_color where id = p_user_id;
    end if;

    update public.guest_claim_requests
    set status = 'rejected', resolved_at = now()
    where guest_key = p_guest_key and status = 'pending';

    -- Carry over favorites of the guest identity to the now-real account,
    -- unless the favoriter already separately favorited that account, or
    -- the favoriter turns out to BE the person being merged (can't favorite
    -- yourself, so that one is just dropped).
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
