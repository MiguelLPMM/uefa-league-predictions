// Loaded after public/vendor/supabase.js (which exposes the global `supabase`
// UMD namespace with `.createClient`). This file wraps that into the actual
// client instance the rest of the app imports.
//
// The URL and anon/publishable key below are meant to be public — Supabase's
// security model is enforced by Row Level Security on the database side, not
// by keeping this key secret. The separate Supabase *secret* key must never
// appear in this file or anywhere else in this repo.
const SUPABASE_URL = 'https://vrugexjxkabgbheyvfqq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xr0ECxSHU6VvA381cSsvcQ_281IHSWt';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
