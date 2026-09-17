// Read-only data access for the leaderboard pages. Everything here relies on
// existing RLS policies (competition_seasons/matches_cache/profiles are
// publicly readable; entries/match_predictions reveal everyone's rows once
// competition_seasons.reveal_unlocked flips) — no new backend writes, and no
// new SQL migration was needed for this phase.
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

// Entries joined with the display info needed to render them, ordered by
// submission time (earliest first) — self/favorites reordering is a later
// phase. profiles isn't a declared foreign key of entries (it mirrors
// auth.users, not entries, so PostgREST can't embed it), hence the second
// query instead of a nested select.
export async function getEntriesWithProfiles(competition, seasonYear) {
    const { data: entries, error } = await supabaseClient
        .from('entries')
        .select('user_id, entry_mode, is_late, late_weeks, submitted_at')
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .order('submitted_at', { ascending: true });
    if (error) throw error;
    if (!entries || entries.length === 0) return [];

    const { data: profiles, error: profilesError } = await supabaseClient
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', entries.map((entry) => entry.user_id));
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));

    return entries.map((entry) => {
        const profile = profileById.get(entry.user_id);
        return {
            ...entry,
            displayName: (profile && profile.display_name) || 'Unknown',
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
