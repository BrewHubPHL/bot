// BrewHub Staff Auth Guard
// Include this at the TOP of any protected page

(async function() {
  const SUPABASE_URL = 'https://rruionkpgswvncypweiv.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydWlvbmtwZ3N3dm5jeXB3ZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzNjU3MjMsImV4cCI6MjA2Mzk0MTcyM30.WAPtNjLOI-kIwHoKrFuejT3P6NqaVMXMrjGqFvJzSxQ';
  
  // Allowed staff emails
  const ALLOWED_EMAILS = ['thomas@brewhubphl.com'];

  // Wait for Supabase to load
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase not loaded. Add the Supabase script before auth.js');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await client.auth.getSession();

  if (!session || !ALLOWED_EMAILS.includes(session.user.email.toLowerCase())) {
    // Not logged in or not authorized - redirect to login
    const currentPath = window.location.pathname;
    window.location.href = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
    return;
  }

  // Expose auth info globally
  window.brewAuth = {
    user: session.user,
    signOut: async () => {
      await client.auth.signOut();
      window.location.href = '/login.html';
    }
  };

  console.log('✅ Authenticated:', session.user.email);
})();
