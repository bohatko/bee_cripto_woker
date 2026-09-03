import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uxsbjkymrqrmlcshizns.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4c2Jqa3ltcnFybWxjc2hpem5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjIwMzYsImV4cCI6MjEwNDAzODAzNn0.fFBh5AsEGqHnra0IMMWnAjalpCmt3wcbVVs9UOQAPWI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
