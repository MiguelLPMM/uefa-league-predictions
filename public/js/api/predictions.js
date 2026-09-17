// Thin wrappers around the Phase 3 Supabase RPCs / tables — kept separate
// from main.js so the predicting page doesn't need to know Supabase's exact
// call shapes.
import { supabaseClient } from '../supabaseClient.js';

// predictions: array of { match_id, home, away }. Returns
// { saved: string[], skipped: string[] } - skipped are matches the freeze
// rule refused to overwrite (already finished + already saved before).
export async function saveMatchPredictionsBatch(competition, seasonYear, predictions) {
    const { data, error } = await supabaseClient.rpc('save_match_predictions_batch', {
        p_competition: competition,
        p_season_year: seasonYear,
        p_predictions: predictions,
    });
    if (error) throw error;
    return data;
}

// Returns an array of { match_id, predicted_home, predicted_away } for the
// signed-in user's own saved predictions.
export async function loadOfficialPredictions(competition, seasonYear) {
    const { data, error } = await supabaseClient.rpc('load_official_predictions', {
        p_competition: competition,
        p_season_year: seasonYear,
    });
    if (error) throw error;
    return data;
}

// Returns the signed-in user's entries row for this competition+season
// (is_late/late_weeks/etc.), or null if they haven't saved a prediction yet.
export async function getMyEntry(userId, competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('entries')
        .select('is_late, late_weeks, entry_mode, submitted_at')
        .eq('user_id', userId)
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .maybeSingle();
    if (error) throw error;
    return data;
}

// True once this competition+season's first match has started — the single
// "deadline" moment after which any existing entry (on-time or late) is
// permanently frozen. Used client-side only to decide whether to warn before
// a save that would lock immediately; the real enforcement is server-side in
// save_match_predictions_batch.
export async function isDeadlinePassed(competition, seasonYear) {
    const { data, error } = await supabaseClient
        .from('competition_seasons')
        .select('reveal_unlocked')
        .eq('competition', competition)
        .eq('season_year', seasonYear)
        .maybeSingle();
    if (error) throw error;
    return Boolean(data && data.reveal_unlocked);
}
