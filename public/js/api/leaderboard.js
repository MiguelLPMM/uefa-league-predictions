// Read-only data access for the leaderboard pages. Everything here relies on
// existing RLS policies (competition_seasons/matches_cache/profiles/
// season_actual_standings are publicly readable; entries/match_predictions/
// fixed_rank_predictions reveal everyone's rows once a competition+season is
// revealed or concluded) — no direct writes here at all.
import { supabaseClient } from '../supabaseClient.js';

// The current (non-concluded) season_year for a competition, plus the reveal
// gate and season status. matches_cache is only ever populated for the
// season sync_matches_and_reveal() currently fetches (whichever season
// api/_lib/uefaMatches.js's getSeasonYear() resolves to), so picking the
// lowest non-'concluded' competition_seasons row for this competition lands
// on the same season without duplicating that September-rollover logic here.
export async function getCurrentCompetitionSeason(competition) {
    const { data, error } = await supabaseClient
        .from('competition_seasons')
        .select('season_year, reveal_unlocked, status')
        .eq('competition', competition)
        .neq('status', 'concluded')
        .order('season_year', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

// Every season on record for a competition (current and concluded), newest
// first - feeds the leaderboard's season selector.
export async function listCompetitionSeasons(competition) {
    const { data, error } = await supabaseClient
        .from('competition_seasons')
        .select('season_year, reveal_unlocked, status')
        .eq('competition', competition)
        .order('season_year', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function getCompetitionSeasonByYear(competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('competition_seasons')
        .select('season_year, reveal_unlocked, status')
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function getMatchesCache(competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('matches_cache')
        .select('id, status, matchday_seq, kickoff_at, home_team_id, home_team_name, home_team_logo, away_team_id, away_team_name, away_team_logo, home_score, away_score')
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .order('matchday_seq', { ascending: true })
        .order('kickoff_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

// A concluded season's permanent final-table snapshot, already sorted by
// actual_rank and shaped like computeStandings()'s own output so callers
// don't need to care which source it came from.
export async function getSeasonActualStandings(competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('season_actual_standings')
        .select('team_id, team_name, team_logo_url, actual_rank')
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .order('actual_rank', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => ({
        id: row.team_id,
        name: row.team_name,
        logo: row.team_logo_url,
        rank: row.actual_rank,
    }));
}

// Entries joined with the display info needed to render them, ordered by
// submission time (earliest first) — self/favorites reordering happens in
// leaderboard.js. profiles isn't a declared foreign key of entries (it
// mirrors auth.users, not entries), hence the second query instead of a
// nested select. Guest entries (user_id is null, imported by the admin with
// no linked account yet) fall back to their own guest_display_name.
export async function getEntriesWithProfiles(competition, seasonYear) {
    const { data: entries, error } = await supabaseClient
        .from('entries')
        .select('id, user_id, guest_display_name, entry_mode, is_late, late_weeks, submitted_at')
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .order('submitted_at', { ascending: true });
    if (error) throw error;
    if (!entries || entries.length === 0) return [];

    const realUserIds = entries.map((entry) => entry.user_id).filter((id) => id != null);
    let profileById = new Map();
    if (realUserIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabaseClient
            .from('profiles')
            .select('id, display_name, avatar_url')
            .in('id', realUserIds);
        if (profilesError) throw profilesError;
        profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }

    return entries.map((entry) => {
        const profile = entry.user_id ? profileById.get(entry.user_id) : null;
        return {
            ...entry,
            displayName: (profile && profile.display_name) || entry.guest_display_name || 'Unknown',
            avatarUrl: profile ? profile.avatar_url : null,
        };
    });
}

export async function getAllPredictions(competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('match_predictions')
        .select('user_id, match_id, predicted_home, predicted_away')
        .eq('competition', competition)
        .eq('season_year', seasonYear);
    if (error) throw error;
    return data || [];
}

// Every fixed-rank (historical/guest) entry's predicted list for this
// competition+season, keyed by entry id and already sorted/shaped like
// computeStandings()'s output.
export async function getFixedRankPredictionsByEntry(competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('fixed_rank_predictions')
        .select('entry_id, team_id, team_name, team_logo_url, predicted_rank, entries!inner(competition, season_year)')
        .eq('entries.competition', competition)
        .eq('entries.season_year', seasonYear)
        .order('predicted_rank', { ascending: true });
    if (error) throw error;

    const byEntry = new Map();
    (data || []).forEach((row) => {
        if (!byEntry.has(row.entry_id)) byEntry.set(row.entry_id, []);
        byEntry.get(row.entry_id).push({
            id: row.team_id,
            name: row.team_name,
            logo: row.team_logo_url,
            rank: row.predicted_rank,
        });
    });
    return byEntry;
}
