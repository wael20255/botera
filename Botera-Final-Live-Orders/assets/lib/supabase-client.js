// ============================================================================
// lib/supabase-client — the ONE Supabase client instance for the whole app.
// Every service imports this file (via a classic <script> tag, since the
// project intentionally has no bundler — see README) instead of creating
// its own client.
// ============================================================================
const SUPABASE_URL = "https://bbixzcaxlvotdhhqfatw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiaXh6Y2F4bHZvdGRoaHFmYXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NzkyMzQsImV4cCI6MjEwMDE1NTIzNH0.jag2l2atrBNwsH6z0HMNx5hgX-JxrVvM3Uh906s_uCA";
// ^ Replace these two values with your real project's, then every service
// below starts talking to real data automatically — nothing else to change.
// Never put a service_role key here; this file ships to the browser.

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

function isSupabaseConfigured() {
  return !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON-PUBLIC-KEY");
}
