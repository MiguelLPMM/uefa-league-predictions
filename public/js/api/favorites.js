// Favorites: server-side per account when signed in (table `favorites`,
// self-managed via direct RLS - the one table safe for plain client writes),
// localStorage fallback when signed out. The two lists are never merged -
// signing in on a device that has local favorites does not import them.
import { supabaseClient } from '../supabaseClient.js';

const LOCAL_KEY = 'favoriteUserIds';

function getLocalFavorites() {
    try {
        const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

function setLocalFavorites(ids) {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(ids));
    } catch (err) {
        // Best effort - worst case the choice doesn't persist.
    }
}

export async function getFavoriteUserIds(userId) {
    if (!userId) return getLocalFavorites();
    const { data, error } = await supabaseClient
        .from('favorites')
        .select('favorite_user_id')
        .eq('user_id', userId);
    if (error) throw error;
    return (data || []).map((row) => row.favorite_user_id);
}

export async function addFavorite(userId, favoriteUserId) {
    if (!userId) {
        const ids = getLocalFavorites();
        if (!ids.includes(favoriteUserId)) setLocalFavorites([...ids, favoriteUserId]);
        return;
    }
    const { error } = await supabaseClient
        .from('favorites')
        .upsert({ user_id: userId, favorite_user_id: favoriteUserId }, { onConflict: 'user_id,favorite_user_id', ignoreDuplicates: true });
    if (error) throw error;
}

export async function removeFavorite(userId, favoriteUserId) {
    if (!userId) {
        setLocalFavorites(getLocalFavorites().filter((id) => id !== favoriteUserId));
        return;
    }
    const { error } = await supabaseClient
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('favorite_user_id', favoriteUserId);
    if (error) throw error;
}
