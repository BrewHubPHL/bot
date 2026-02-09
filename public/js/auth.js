// BrewHub Staff Auth Guard - Database-Driven
(async function() {
  const SUPABASE_URL = 'https://rruionkpgswvncypweiv.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydWlvbmtwZ3N3dm5jeXB3ZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTQ5MDYsImV4cCI6MjA4NDg5MDkwNn0.fzM310q9Qs_f-zhuBqyjnQXs3mDmOp_dbiFRs0ctQmU';

  if (typeof window.supabase === 'undefined') {
    console.error('Supabase not loaded.');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storageKey: 'brewhub-staff-auth',
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  // Cache staff lookup to avoid repeated queries (persists in sessionStorage)
  let staffCache = null;
  
  // Try to restore staff cache from sessionStorage for back/forward navigation
  try {
    const cached = sessionStorage.getItem('brewhub-staff-cache');
    if (cached) staffCache = JSON.parse(cached);
  } catch (e) {}

  window.brewAuth = {
    client: client,
    session: null,
    staff: null,

    // Check if user is in staff_directory (uses RLS policy for self-read)
    protectPage: async function(options = {}) {
      const requiredRole = options.requiredRole || 'staff';
      const roleHierarchy = { staff: 1, manager: 2, admin: 3 };
      
      // Wait a moment for session to restore from storage
      let session = null;
      for (let i = 0; i < 3; i++) {
        const { data } = await client.auth.getSession();
        session = data.session;
        if (session) break;
        await new Promise(r => setTimeout(r, 100));
      }
      
      if (!session) {
        const currentPath = window.location.pathname;
        window.location.href = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
        return null;
      }

      // Lookup staff from database (RLS allows self-read)
      // Use cache if email matches to avoid unnecessary queries on back/forward
      if (!staffCache || staffCache.email !== session.user.email.toLowerCase()) {
        const { data: staffRow, error } = await client
          .from('staff_directory')
          .select('email, role, full_name')
          .eq('email', session.user.email.toLowerCase())
          .single();

        if (error || !staffRow) {
          console.error('Not in staff directory:', session.user.email);
          await client.auth.signOut();
          window.location.href = '/login.html?error=not_staff';
          return null;
        }
        staffCache = staffRow;
        // Persist to sessionStorage for back/forward nav
        try { sessionStorage.setItem('brewhub-staff-cache', JSON.stringify(staffCache)); } catch (e) {}
      }

      // Check role hierarchy
      const userLevel = roleHierarchy[staffCache.role] || 0;
      const requiredLevel = roleHierarchy[requiredRole] || 1;
      
      if (userLevel < requiredLevel) {
        alert(`Access denied. Requires ${requiredRole} role.`);
        window.location.href = '/';
        return null;
      }

      this.session = session;
      this.staff = staffCache;
      return session.user;
    },

    // Check role without redirect (for UI conditionals)
    hasRole: function(role) {
      const roleHierarchy = { staff: 1, manager: 2, admin: 3 };
      if (!this.staff) return false;
      return (roleHierarchy[this.staff.role] || 0) >= (roleHierarchy[role] || 1);
    },

    signOut: async () => {
      staffCache = null;
      try { sessionStorage.removeItem('brewhub-staff-cache'); } catch (e) {}
      await client.auth.signOut();
      window.location.href = '/';
    }
  };
})();