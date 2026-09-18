// The self-serve "is this you" flow for guest (no-account) historical
// entries - the first-sign-in prompt (guestClaimPrompt.js), the persistent
// Profile page (profile.js) where it can be revisited/cancelled anytime, and
// the small pieces the admin's manual-merge tool reuses.
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

// The caller's own still-pending request, or null - a user can only ever
// have one active proposal at a time (see requestGuestClaim below).
export async function getMyPendingClaimRequest(userId) {
    const { data, error } = await supabaseClient
        .from('guest_claim_requests')
        .select('id, guest_key, created_at')
        .eq('requested_by_user_id', userId)
        .eq('status', 'pending')
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const { data: entryRow, error: entryError } = await supabaseClient
        .from('entries')
        .select('guest_display_name')
        .eq('guest_key', data.guest_key)
        .is('user_id', null)
        .limit(1)
        .maybeSingle();
    if (entryError) throw entryError;

    return {
        id: data.id,
        guestKey: data.guest_key,
        displayName: entryRow ? entryRow.guest_display_name : data.guest_key,
        createdAt: data.created_at,
    };
}

// True once a user has completed one self-serve (or admin) merge - the only
// way a real user_id ends up on an entry_mode = 'fixed_rank' entry. Once
// true, the RLS insert policy on guest_claim_requests refuses any further
// self-serve request from them - see the 0012 migration for why (a second
// mistaken approval could wipe an already-correct entry). This is checked
// client-side too so the UI can explain why, rather than surfacing a raw
// RLS error.
export async function hasCompletedGuestMerge(userId) {
    const { data, error } = await supabaseClient
        .from('entries')
        .select('id')
        .eq('user_id', userId)
        .eq('entry_mode', 'fixed_rank')
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
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

// A user only ever has one active proposal at a time - submitting a new one
// replaces any existing pending request rather than accumulating alongside
// it (that's what makes the Profile page's "propose a different one" work
// without a separate "cancel first" step).
export async function requestGuestClaim(userId, guestKey) {
    const { error: deleteError } = await supabaseClient
        .from('guest_claim_requests')
        .delete()
        .eq('requested_by_user_id', userId)
        .eq('status', 'pending');
    if (deleteError) throw deleteError;

    const { error } = await supabaseClient
        .from('guest_claim_requests')
        .insert({ requested_by_user_id: userId, guest_key: guestKey });
    if (error) throw error;
}

export async function cancelGuestClaimRequest(requestId) {
    const { error } = await supabaseClient
        .from('guest_claim_requests')
        .delete()
        .eq('id', requestId);
    if (error) throw error;
}
