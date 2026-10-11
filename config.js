// ==============================================================================
// SAMARPIT IRANIWADI - Supabase & Auth Configuration
// ==============================================================================
// You can either:
// 1. Enter your Supabase Project URL and Public Anon Key below, OR
// 2. Click the gear icon (⚙️) inside the website to enter them directly in the browser!
//
// These keys are 100% safe to expose in client-side code because Supabase
// Row-Level Security (RLS) policies protect your database at the database engine level.
// ==============================================================================

window.APP_CONFIG = {
  // Replace with your Supabase Project URL (e.g. "https://abcdefghijklm.supabase.co")
  SUPABASE_URL: window.SUPABASE_URL || "",

  // Replace with your Supabase Anon Public Key (starts with "eyJhbGciOi...")
  SUPABASE_ANON_KEY: window.SUPABASE_ANON_KEY || "",

  // OAuth Provider configuration
  AUTH_PROVIDER: "google",

  // App Metadata
  APP_NAME: "SAMARPIT IRANIWADI",
  APP_SUBTITLE: "Bhulku records, attendance and sabha schedule"
};
