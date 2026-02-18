/**
 * BREWHUB CLOCK IN/OUT - HARDENED HANDLER
 * Defensive implementation with detailed error diagnostics
 */

(function() {
    'use strict';

    // === CONFIGURATION ===
    const CONFIG = {
        // Try multiple possible endpoints (in case of rename)
        endpoints: [
            '/.netlify/functions/log-time', // Correct Netlify function endpoint
            '/api/time-logs',
            '/api/timelog',
            '/api/clock',
            '/rpc/time_logs',
            '/rpc/clock_action'
        ],
        // Multiple selectors for staff ID (defensive)
        staffIdSelectors: [
            '#staff_id',
            '#staffId', 
            '#user_id',
            '#userId',
            '[name="staff_id"]',
            '[name="staffId"]',
            '[data-staff-id]',
            '[data-user-id]',
            '.staff-id-field',
            '#hidden-staff-id'
        ],
        // Multiple button selectors
        buttonSelectors: [
            '#clock-in-btn',
            '#clock-out-btn',
            '#clockInBtn',
            '#clockOutBtn',
            '[data-action="clock-in"]',
            '[data-action="clock-out"]',
            '.clock-btn',
            '.clock-in-button',
            '.clock-out-button'
        ]
    };

    // === GET STAFF ID (DEFENSIVE) ===
    function getStaffId() {
        // Method 1: Check hidden fields / inputs
        for (const selector of CONFIG.staffIdSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const value = el.value || el.dataset.staffId || el.dataset.userId || el.textContent;
                if (value && value.trim()) {
                    console.log('[ClockHandler] Staff ID found via:', selector);
                    return value.trim();
                }
            }
        }

        // Method 2: Check session storage
        const sessionStaff = sessionStorage.getItem('staff_id') || 
                            sessionStorage.getItem('staffId') ||
                            sessionStorage.getItem('user_id');
        if (sessionStaff) {
            console.log('[ClockHandler] Staff ID found in sessionStorage');
            return sessionStaff;
        }

        // Method 3: Check localStorage
        const localStaff = localStorage.getItem('staff_id') || 
                          localStorage.getItem('staffId') ||
                          localStorage.getItem('user_id');
        if (localStaff) {
            console.log('[ClockHandler] Staff ID found in localStorage');
            return localStaff;
        }

        // Method 4: Check for global auth object
        if (window.brewhubAuth?.staffId) return window.brewhubAuth.staffId;
        if (window.brewhubAuth?.staff_id) return window.brewhubAuth.staff_id;
        if (window.currentUser?.id) return window.currentUser.id;
        if (window.__STAFF_ID__) return window.__STAFF_ID__;

        // Method 5: Parse from Supabase session if available
        try {
            const supabaseAuth = localStorage.getItem('supabase.auth.token');
            if (supabaseAuth) {
                const parsed = JSON.parse(supabaseAuth);
                const userId = parsed?.currentSession?.user?.id;
                if (userId) {
                    console.log('[ClockHandler] Staff ID found in Supabase session');
                    return userId;
                }
            }
        } catch (e) {
            console.warn('[ClockHandler] Could not parse Supabase session');
        }

        return null;
    }

    // === VISUAL FEEDBACK ===
    function setButtonState(button, state, message) {
        // Remove existing states
        button.classList.remove('clock-success', 'clock-error', 'clock-loading');
        button.disabled = false;

        const originalText = button.dataset.originalText || button.textContent;
        button.dataset.originalText = originalText;

        switch (state) {
            case 'loading':
                button.classList.add('clock-loading');
                button.disabled = true;
                button.textContent = 'Processing...';
                break;
            case 'success':
                button.classList.add('clock-success');
                button.textContent = message || '✓ Success!';
                setTimeout(() => {
                    button.classList.remove('clock-success');
                    button.textContent = originalText;
                }, 3000);
                break;
            case 'error':
                button.classList.add('clock-error');
                button.textContent = message || '✗ Error';
                setTimeout(() => {
                    button.classList.remove('clock-error');
                    button.textContent = originalText;
                }, 5000);
                break;
            default:
                button.textContent = originalText;
        }
    }

    // === ERROR DIAGNOSTICS ===
    function diagnoseError(status, responseText) {
        const diagnostics = {
            status: status,
            category: 'UNKNOWN',
            message: '',
            suggestion: ''
        };

        switch (status) {
            case 400:
                diagnostics.category = 'PAYLOAD';
                diagnostics.message = 'Bad Request - Invalid data sent';
                diagnostics.suggestion = 'Check staff_id format and required fields';
                break;
            case 401:
                diagnostics.category = 'AUTH';
                diagnostics.message = 'Unauthorized - Session expired or invalid';
                diagnostics.suggestion = 'Staff member needs to log in again';
                break;
            case 403:
                diagnostics.category = 'AUTH';
                diagnostics.message = 'Forbidden - Insufficient permissions';
                diagnostics.suggestion = 'Check staff role permissions in database';
                break;
            case 404:
                diagnostics.category = 'ENDPOINT';
                diagnostics.message = 'Not Found - API endpoint missing';
                diagnostics.suggestion = 'Verify RPC function exists: time_logs or clock_action';
                break;
            case 409:
                diagnostics.category = 'LOGIC';
                diagnostics.message = 'Conflict - Already clocked in/out';
                diagnostics.suggestion = 'Check existing time log entries for today';
                break;
            case 422:
                diagnostics.category = 'PAYLOAD';
                diagnostics.message = 'Validation Failed';
                diagnostics.suggestion = 'Check required fields: staff_id, action, timestamp';
                break;
            case 500:
                diagnostics.category = 'DATABASE';
                diagnostics.message = 'Server Error - Database or RPC failure';
                diagnostics.suggestion = 'Check Supabase logs for RPC errors';
                break;
            case 502:
            case 503:
            case 504:
                diagnostics.category = 'SERVER';
                diagnostics.message = 'Service Unavailable';
                diagnostics.suggestion = 'Check Supabase service status';
                break;
            default:
                if (status === 0) {
                    diagnostics.category = 'NETWORK';
                    diagnostics.message = 'Network Error - No connection';
                    diagnostics.suggestion = 'Check internet connection and CORS settings';
                }
        }

        // Try to parse response for more details
        try {
            const parsed = JSON.parse(responseText);
            if (parsed.message) diagnostics.serverMessage = parsed.message;
            if (parsed.error) diagnostics.serverError = parsed.error;
            if (parsed.code) diagnostics.serverCode = parsed.code;
        } catch (e) {
            diagnostics.rawResponse = responseText?.substring(0, 200);
        }

        return diagnostics;
    }

    // === MAIN CLOCK HANDLER ===
    async function handleClockAction(event, action) {
        event.preventDefault();
        event.stopPropagation();

        const button = event.currentTarget;
        console.log('[ClockHandler] Clock action triggered:', action);

        // Get staff ID
        const staffId = getStaffId();
        if (!staffId) {
            const errorMsg = 'ERROR: Staff ID not found. Please log in again.';
            alert(`${errorMsg}\n\nDiagnostic: Could not locate staff_id in DOM, session, or auth state.`);
            setButtonState(button, 'error', 'No Staff ID');
            return;
        }

        console.log('[ClockHandler] Staff ID:', staffId);
        setButtonState(button, 'loading');

        // Build payload
        const payload = {
            staff_id: staffId,
            action: action, // 'clock_in' or 'clock_out'
            timestamp: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };

        console.log('[ClockHandler] Payload:', payload);

        // Try endpoints in order
        let lastError = null;
        for (const endpoint of CONFIG.endpoints) {
            try {
                console.log('[ClockHandler] Trying endpoint:', endpoint);
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        // Include auth header if available
                        ...(window.supabaseClient?.auth?.session()?.access_token && {
                            'Authorization': `Bearer ${window.supabaseClient.auth.session().access_token}`
                        })
                    },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });

                const responseText = await response.text();

                if (response.ok) {
                    console.log('[ClockHandler] Success!', responseText);
                    setButtonState(button, 'success', action === 'clock_in' ? '✓ Clocked In!' : '✓ Clocked Out!');
                    
                    // Optional: Refresh time log display
                    if (typeof window.refreshTimeLogs === 'function') {
                        window.refreshTimeLogs();
                    }
                    return;
                }

                // Store error for diagnostics
                lastError = {
                    status: response.status,
                    text: responseText,
                    endpoint: endpoint
                };

                // Don't try other endpoints for auth errors
                if (response.status === 401 || response.status === 403) {
                    break;
                }

            } catch (networkError) {
                console.error('[ClockHandler] Network error on', endpoint, networkError);
                lastError = {
                    status: 0,
                    text: networkError.message,
                    endpoint: endpoint
                };
            }
        }

        // All endpoints failed - show detailed error
        const diagnostics = diagnoseError(lastError.status, lastError.text);
        
        const alertMessage = `
═══ CLOCK ${action.toUpperCase()} FAILED ═══

ERROR CODE: ${lastError.status}
CATEGORY: ${diagnostics.category}
MESSAGE: ${diagnostics.message}

${diagnostics.serverMessage ? `SERVER: ${diagnostics.serverMessage}\n` : ''}
SUGGESTION: ${diagnostics.suggestion}

ENDPOINT TRIED: ${lastError.endpoint}
STAFF ID USED: ${staffId}

(Screenshot this for IT support)
        `.trim();

        alert(alertMessage);
        console.error('[ClockHandler] Full diagnostics:', diagnostics);
        
        setButtonState(button, 'error', `Error ${lastError.status}`);
    }

    // === ATTACH EVENT LISTENERS ===
    function init() {
        console.log('[ClockHandler] Initializing...');

        // Find and attach to all possible clock buttons
        let attached = 0;
        
        for (const selector of CONFIG.buttonSelectors) {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach(button => {
                if (button.dataset.clockHandlerAttached) return;
                
                // Determine action from button attributes/text
                const action = button.id?.includes('out') || 
                              button.dataset.action?.includes('out') ||
                              button.textContent?.toLowerCase().includes('out')
                              ? 'clock_out' : 'clock_in';

                button.addEventListener('click', (e) => handleClockAction(e, action));
                button.dataset.clockHandlerAttached = 'true';
                attached++;
                console.log('[ClockHandler] Attached to:', selector, '- Action:', action);
            });
        }

        if (attached === 0) {
            console.warn('[ClockHandler] No clock buttons found! Selectors tried:', CONFIG.buttonSelectors);
        } else {
            console.log(`[ClockHandler] Ready. Attached to ${attached} button(s).`);
        }
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Also run on any dynamic content loads
    const observer = new MutationObserver(() => {
        init();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Expose for debugging (localhost only)
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        window.BrewHubClockDebug = {
            getStaffId,
            testClock: (action) => handleClockAction({ preventDefault: () => {}, stopPropagation: () => {}, currentTarget: document.querySelector('#clock-in-btn') || {} }, action || 'clock_in'),
            config: CONFIG
        };
    }

})();
