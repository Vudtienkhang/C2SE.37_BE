import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
