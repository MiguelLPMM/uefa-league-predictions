// Client-side admin check — cosmetic only (hides/shows the Admin link and
// page content). The real enforcement is server-side: every admin RPC checks
// auth.uid() against the same hardcoded id in Postgres (see the SQL
// migrations), so this constant being wrong or spoofed can't grant anyone
// real access.
//
// TODO: fill this in once you've signed in with Google at least once —
// find your user id in the Supabase dashboard under Authentication > Users
// (or run `select id from auth.users where email = 'miguellpmm@gmail.com';`
// in the SQL editor), then paste it here.
export const ADMIN_USER_ID = '472834c9-c460-4597-9f1e-d29ff8bcb9cc';

export function isAdminUser(user) {
    return Boolean(user && ADMIN_USER_ID && user.id === ADMIN_USER_ID);
}
