import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Default Supabase client (anon key, no persistent auth session). */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Factory for pages that need custom auth options (e.g. persistent session).
 * Keeps credentials centralised while allowing per-page configuration.
 */
export function createSupabaseClient(options?: SupabaseClientOptions<'public'>) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
}
