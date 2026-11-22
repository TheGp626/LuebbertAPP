// Supabase Client Initialization
// REPLACE THESE WITH YOUR ACTUAL SUPABASE URL AND ANON KEY
const SUPABASE_URL = 'https://bdbjimmmksjyqmvopklk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkYmppbW1ta3NqeXFtdm9wa2xrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNzc2OTksImV4cCI6MjExMDk1MzY5OX0.Ra77csalnnl6umi7_Fat0pq15Ozge7oTcjDjGjUOj0Y';

// The 'supabase' object becomes globally available via the CDN script in index.html
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Web Push (AL-Erinnerungen): public VAPID key, not a secret. Private key lives in Supabase secrets.
const VAPID_PUBLIC_KEY = 'BCXwSHB59c6-6xMJAtk0LifAj7qR_9MdFwE5ogbPkPnWE810PtoVh98aZOEpsyMgqFX63iua3Eg-6-wDWGtnqJQ';
