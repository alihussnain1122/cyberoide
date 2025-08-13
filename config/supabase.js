import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Resolve Supabase env values with multiple fallback variable names a user might try
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
// Prefer service role; fall back to possible alternative names if user misnamed variable
const supabaseKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY || // last resort (anon key may have limited perms)
  ''
).trim();

// Create a mock Supabase client if credentials are missing
let supabaseClient;

// Detect common misconfiguration: using a Postgres connection string instead of the HTTP API URL
if (supabaseUrl.startsWith('postgres')) {
  console.error('\n❌ SUPABASE_URL appears to be a Postgres connection string.');
  console.error('Expected something like: https://<project-ref>.supabase.co');
  console.error('You used: ' + supabaseUrl);
  console.error('Copy the Project URL from Supabase dashboard (Settings > API).');
}

if (!supabaseUrl || !supabaseKey || supabaseUrl.startsWith('postgres')) {
  const problems = [];
  if (!supabaseUrl) problems.push('SUPABASE_URL missing');
  if (supabaseUrl.startsWith('postgres')) problems.push('SUPABASE_URL is Postgres string, needs https URL');
  if (!supabaseKey) problems.push('SUPABASE_SERVICE_ROLE_KEY (or fallback key) missing');
  console.error('\n❌ Supabase configuration invalid: ' + problems.join('; '));
  console.error('Fix: In backend/.env set:');
  console.error('  SUPABASE_URL=https://<project-ref>.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<service_role_key>');
  console.error('Then restart the server.');
  // Provide a mock client but also mark a flag so callers can choose to abort early
  supabaseClient = {
    __notConfigured: true,
    storage: {
      from: () => ({
        upload: async () => ({ error: { message: 'Supabase not configured' } }),
        createSignedUrl: async () => ({ error: { message: 'Supabase not configured' } }),
        remove: async () => ({ error: { message: 'Supabase not configured' } })
      })
    }
  };
} else {
  // Create the Supabase client
  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  // Verify the connection
  const checkConnection = async () => {
    try {
      const { data, error } = await supabaseClient.storage.getBucket(process.env.SUPABASE_BUCKET || 'courses');
      if (error) {
        console.warn('Supabase connection error:', error.message);
      } else {
        console.log('Supabase storage connection successful. Bucket:', data?.name || 'courses');
      }
    } catch (err) {
      console.error('Failed to connect to Supabase:', err.message);
    }
  };
  
  // Check connection but don't block startup
  checkConnection();
}

export const supabase = supabaseClient;

// Storage bucket name
export const bucket = process.env.SUPABASE_BUCKET || 'courses';

/**
 * Helper function to clean up expired files (optional, can be run periodically)
 * @returns {Promise<{removed: number, errors: Array}>}
 */
export const cleanupOldFiles = async (olderThanDays = 7) => {
  if (!supabaseUrl || !supabaseKey || supabase.__notConfigured) {
    return { removed: 0, errors: ['Supabase not configured'] };
  }
  
  try {
    // List all files in the bucket
    const { data: files, error } = await supabase.storage.from(bucket).list();
    
    if (error) {
      console.error('Error listing files:', error);
      return { removed: 0, errors: [error.message] };
    }
    
    // Filter for temporary files older than the specified days
    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - olderThanDays));
    
    const temporaryFilePaths = files
      .filter(file => {
        // Filter logic based on your naming convention
        // This example assumes temporary files have 'temp_' prefix
        return file.name.startsWith('temp_') && new Date(file.created_at) < cutoffDate;
      })
      .map(file => file.name);
    
    if (temporaryFilePaths.length === 0) {
      return { removed: 0, errors: [] };
    }
    
    // Delete the files in batches of 100 (Supabase limit)
    const errors = [];
    let removed = 0;
    
    for (let i = 0; i < temporaryFilePaths.length; i += 100) {
      const batch = temporaryFilePaths.slice(i, i + 100);
      const { error: deleteError } = await supabase.storage.from(bucket).remove(batch);
      
      if (deleteError) {
        errors.push(`Batch ${i/100 + 1}: ${deleteError.message}`);
      } else {
        removed += batch.length;
      }
    }
    
    return { removed, errors };
  } catch (err) {
    console.error('Cleanup error:', err);
    return { removed: 0, errors: [err.message] };
  }
};

