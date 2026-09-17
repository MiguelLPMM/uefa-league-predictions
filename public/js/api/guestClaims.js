// The self-serve "is this you" flow for guest (no-account) historical
// entries, plus the small pieces the admin's manual-merge tool reuses.
import { supabaseClient } from '../supabaseClient.js';

// Every currently-unclaimed guest identity (grouped by guest_key, which can
// span multiple competitions/seasons for the same real person) - visible to
// anyone (see the "unclaimed guest entries are discoverable" RLS policy on
// entries) since it's just names, not predictions.
export async function listUnclaimedGuestIdentities() {
    const { data, error } = await supabaseClient
        .from('entries')
        .select('guest_key, guest_display_name, competition, season_year')
        .is('user_id', null)
        .order('guest_display_name', { ascending: true });
    if (error) throw error;

    const byKey = new Map();
    (data || []).forEach((row) => {
        if (!byKey.has(row.guest_key)) {
            byKey.set(row.guest_key, { guestKey: row.guest_key, displayName: row.guest_display_name, seasons: [] });
        }
        byKey.get(row.guest_key).seasons.push({ competition: row.competition, seasonYear: row.season_year });
    });
    return Array.from(byKey.values());
}

export async function getMyGuestClaimRequests(userId) {
    const { data, error } = await supabaseClient
        .from('guest_claim_requests')
        .select('id, guest_key, status')
        .eq('requested_by_user_id', userId);
    if (error) throw error;
    return data || [];
}

export async function hasDismissedGuestClaimPrompt(userId) {
    const { data, error } = await supabaseClient
        .from('guest_claim_dismissals')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

export async function dismissGuestClaimPrompt(userId) {
    const { error } = await supabaseClient
        .from('guest_claim_dismissals')
        .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw error;
}

export async function requestGuestClaim(userId, guestKey) {
    const { error } = await supabaseClient
        .from('guest_claim_requests')
        .insert({ requested_by_user_id: userId, guest_key: guestKey });
    if (error) throw error;
}
