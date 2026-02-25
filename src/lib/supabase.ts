import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getBrowserSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

const DEFAULT_AUTH = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storage: getBrowserSessionStorage(),
  storageKey: 'brewhub-auth-session',
};

/**
 * Default Supabase browser client.
 * Sessions are scoped to sessionStorage to reduce token persistence risk.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: DEFAULT_AUTH,
});

/**
 * Factory for pages that need custom auth options (e.g. persistent session).
 * Keeps credentials centralised while allowing per-page configuration.
 */
export function createSupabaseClient(options?: SupabaseClientOptions<'public'>) {
  const merged: SupabaseClientOptions<'public'> = {
    ...options,
    auth: {
      ...DEFAULT_AUTH,
      ...(options?.auth ?? {}),
    },
  };
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, merged);
}
