import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * In-memory storage adapter — tokens never touch localStorage or sessionStorage.
 * On shared POS iPads this guarantees zero token residue between operators.
 * Tokens vanish the moment the browser tab closes.
 */
const memoryStore = new Map<string, string>();
const inMemoryStorage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStore.set(key, value); },
  removeItem: (key: string) => { memoryStore.delete(key); },
};

const DEFAULT_AUTH = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  storage: inMemoryStorage,
  storageKey: 'brewhub-auth-session',
};

/**
 * Default Supabase browser client.
 * Sessions are strictly in-memory — no localStorage/sessionStorage persistence.
 * This prevents token residue on shared POS iPads between operator sessions.
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
