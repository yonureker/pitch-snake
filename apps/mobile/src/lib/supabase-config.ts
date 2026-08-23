/**
 * The shared Supabase project this app talks to, read from app config so the
 * publishable key never sits in linted source (and can differ per build
 * profile later). Same project and same RPCs as the web page.
 * @module
 */
import Constants from 'expo-constants';

interface SupabaseExtra {
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
}

const extra = (Constants.expoConfig?.extra ?? {}) as SupabaseExtra;

/** Project base URL, e.g. https://ref.supabase.co; empty when unconfigured. */
export const SUPABASE_URL = typeof extra.supabaseUrl === 'string' ? extra.supabaseUrl : '';

/** The publishable (anon) key; public by design, empty when unconfigured. */
export const SUPABASE_ANON_KEY = typeof extra.supabaseAnonKey === 'string' ? extra.supabaseAnonKey : '';

/** True when both pieces of config are present. */
export const SUPABASE_CONFIGURED = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
