// Supabase Client Initialization
// REPLACE THESE WITH YOUR ACTUAL SUPABASE URL AND ANON KEY
const SUPABASE_URL = 'https://jbrvghmkftvnkjmyoigv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpicnZnaG1rZnR2bmtqbXlvaWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTgwMTUsImV4cCI6MjA4OTQ5NDAxNX0.1yTF4Nm8MdwbDU1itJRmFNAMB3d0nElRd9hHrGzTIG4';

// The 'supabase' object becomes globally available via the CDN script in index.html
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
