import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rruionkpgswvncypweiv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydWlvbmtwZ3N3dm5jeXB3ZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTQ5MDYsImV4cCI6MjA4NDg5MDkwNn0.fzM310q9Qs_f-zhuBqyjnQXs3mDmOp_dbiFRs0ctQmU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
