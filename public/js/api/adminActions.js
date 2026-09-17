// Thin wrappers around the admin-only Supabase RPCs. Every one of these is
// re-checked server-side against the hardcoded admin user id (see the SQL
// migrations) - the client-side admin gate (adminConfig.js) is cosmetic only.
import { supabaseClient } from '../supabaseClient.js';

// rankings: array of { team_id, team_name, team_logo_url, predicted_rank },
// ranked 1..N — real team data (see api/seasonMatches.js), not typed names,
// so these ids actually match whatever the real actual standings use later.
export async function importGuestEntry(guestKey, displayName, competition, seasonYear, rankings, isLate, lateWeeks) {
    const { data, error } = await supabaseClient.rpc('admin_import_guest_entry', {
        p_guest_key: guestKey,
        p_display_name: displayName,
        p_competition: competition,
        p_season_year: seasonYear,
        p_rankings: rankings,
        p_is_late: isLate,
        p_late_weeks: lateWeeks,
    });
    if (error) throw error;
    return data;
}

// Merges every still-unclaimed entry sharing this guest_key into one real
// account at once. Returns { merged: number, overwritten: [{competition, season_year}] }
// for any competition+season where the user already had their own entry -
// that entry (and its match_predictions) gets replaced by the import.
export async function mergeGuestKey(guestKey, userId) {
    const { data, error } = await supabaseClient.rpc('admin_merge_guest_key', {
        p_guest_key: guestKey,
        p_user_id: userId,
    });
    if (error) throw error;
    return data;
}

export async function reviewGuestClaim(requestId, approve) {
    const { error } = await supabaseClient.rpc('admin_review_guest_claim', {
        p_request_id: requestId,
        p_approve: approve,
    });
    if (error) throw error;
}

// Returns { userId, displayName, avatarUrl } or null if no account exists
// with that email (or, for a non-admin caller, the RPC itself refuses).
export async function findUserByEmail(email) {
    const { data, error } = await supabaseClient.rpc('admin_find_user_by_email', { p_email: email });
    if (error) throw error;
    const row = (data || [])[0];
    if (!row) return null;
    return { userId: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url };
}

export async function listPendingGuestClaimRequests() {
    const { data: requests, error } = await supabaseClient
        .from('guest_claim_requests')
        .select('id, guest_key, requested_by_user_id, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
    if (error) throw error;
    if (!requests || requests.length === 0) return [];

    const guestKeys = [...new Set(requests.map((request) => request.guest_key))];
    const { data: guestEntries, error: guestError } = await supabaseClient
        .from('entries')
        .select('guest_key, guest_display_name, competition, season_year')
        .in('guest_key', guestKeys)
        .is('user_id', null);
    if (guestError) throw guestError;

    const infoByKey = new Map();
    (guestEntries || []).forEach((entry) => {
        if (!infoByKey.has(entry.guest_key)) {
            infoByKey.set(entry.guest_key, { displayName: entry.guest_display_name, seasons: [] });
        }
        infoByKey.get(entry.guest_key).seasons.push(`${entry.competition.toUpperCase()} ${entry.season_year - 1}/${String(entry.season_year).slice(-2)}`);
    });

    const { data: profiles, error: profilesError } = await supabaseClient
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', requests.map((request) => request.requested_by_user_id));
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));

    return requests.map((request) => {
        const guestInfo = infoByKey.get(request.guest_key) || { displayName: request.guest_key, seasons: [] };
        const profile = profileById.get(request.requested_by_user_id);
        return {
            id: request.id,
            guestKey: request.guest_key,
            guestDisplayName: guestInfo.displayName,
            seasons: guestInfo.seasons,
            requesterDisplayName: (profile && profile.display_name) || 'Unknown',
            requesterAvatarUrl: profile ? profile.avatar_url : null,
            createdAt: request.created_at,
        };
    });
}
