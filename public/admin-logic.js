// BrewBot Admin Dashboard Logic
// Requires auth.js to be loaded first

(async function() {
    // Wait for auth system
    while (!window.brewAuth) {
        await new Promise(r => setTimeout(r, 100));
    }

    const sb = window.brewAuth.client;
    const statusEl = document.getElementById('voice-status');
    const micEl = document.getElementById('mic-status');
    const startBtn = document.getElementById('start-bot');

    // Check if user is manager
    async function checkManagerAccess() {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    }

    // Voice status simulation (placeholder for future ElevenLabs ConvAI integration)
    let botActive = false;

    startBtn.addEventListener('click', async () => {
        if (!await checkManagerAccess()) return;

        botActive = !botActive;
        
        if (botActive) {
            startBtn.textContent = 'Put BrewBot to Sleep';
            startBtn.style.background = '#c0392b';
            statusEl.textContent = 'Active';
            statusEl.className = 'active';
            micEl.textContent = 'Listening...';
        } else {
            startBtn.textContent = 'Wake up BrewBot';
            startBtn.style.background = '';
            statusEl.textContent = 'Sleeping';
            statusEl.className = '';
            micEl.textContent = 'Ready';
        }
    });

    // Initial state
    if (await checkManagerAccess()) {
        statusEl.textContent = 'Sleeping';
    }
})();
