// Favorites: signed-in only (no localStorage fallback for signed-out
// visitors - see the project's memory notes for why that was removed), and
// can target either a real account (favorite_user_id) or a still-unclaimed
// guest identity (favorite_guest_key) - the row is self-managed via direct
// RLS either way. When a favorited guest gets merged into a real account,
// admin_merge_guest_key carries the favorite over automatically.
import { supabaseClient } from '../supabaseClient.js';

// Returns { userIds: Set<string>, guestKeys: Set<string> } - empty sets for
// a signed-out caller, since there's nothing to look up.
export async function getFavorites(userId) {
    if (!userId) return { userIds: new Set(), guestKeys: new Set() };
    const { data, error } = await supabaseClient
        .from('favorites')
        .select('favorite_user_id, favorite_guest_key')
        .eq('user_id', userId);
    if (error) throw error;

    const userIds = new Set();
    const guestKeys = new Set();
    (data || []).forEach((row) => {
        if (row.favorite_user_id) userIds.add(row.favorite_user_id);
        if (row.favorite_guest_key) guestKeys.add(row.favorite_guest_key);
    });
    return { userIds, guestKeys };
}

export async function addFavoriteUser(userId, favoriteUserId) {
    const { error } = await supabaseClient
        .from('favorites')
        .insert({ user_id: userId, favorite_user_id: favoriteUserId });
    if (error && error.code !== '23505') throw error; // 23505 = already favorited, fine
}

export async function removeFavoriteUser(userId, favoriteUserId) {
    const { error } = await supabaseClient
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('favorite_user_id', favoriteUserId);
    if (error) throw error;
}

export async function addFavoriteGuest(userId, guestKey) {
    const { error } = await supabaseClient
        .from('favorites')
        .insert({ user_id: userId, favorite_guest_key: guestKey });
    if (error && error.code !== '23505') throw error;
}

export async function removeFavoriteGuest(userId, guestKey) {
    const { error } = await supabaseClient
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('favorite_guest_key', guestKey);
    if (error) throw error;
}
