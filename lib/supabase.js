/**
 * lib/supabase.js — Single canonical Supabase client for the entire backend.
 * Import from here everywhere. Never instantiate createClient() elsewhere.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('💥 CRITICAL: SUPABASE_URL or SUPABASE_ANON_KEY missing from .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
