import { SupabaseClient } from '@supabase/supabase-js';
declare module "@/lib/supabase" {
  export const supabase: SupabaseClient;
}
