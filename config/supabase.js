import {createClient} from '@supabase/supabase-js';

// Provide defaults for development or warn about missing environment variables
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Create a mock Supabase client if credentials are missing
let supabaseClient;

if (!supabaseUrl || !supabaseKey) {
  console.warn(' Supabase URL and Service Role Key not set in environment variables.');
  console.warn(' Storage functionality will not work until these are configured.');
  
  // Mock client with no-op methods
  supabaseClient = {
    storage: {
      from: () => ({
        upload: async () => ({ error: { message: 'Supabase not configured' } }),
        createSignedUrl: async () => ({ error: { message: 'Supabase not configured' } })
      })
    }
  };
} else {
  supabaseClient = createClient(supabaseUrl, supabaseKey);
}

export const supabase = supabaseClient;

// Storage bucket name
export const bucket = process.env.SUPABASE_BUCKET || 'courses';