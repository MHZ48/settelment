/**
 * Session Persistence & Device Sync
 * Stores sessions permanently and syncs across devices using a unique device ID
 * No authentication required - works out of the box
 */

// ════════════════════════════════════════════════════════════════
// GLOBAL SESSION MANAGER
// ════════════════════════════════════════════════════════════════
let sessionManager = null;
let isInitialized = false;

const SUPABASE_URL_BASE = 'https://dwhckbcrlgjesxniqmmr.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3aGNrYmNybGdqZXN4bmlxbW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTI5MDMsImV4cCI6MjA5MDkyODkwM30.8rkrHvEUttojlRwR1mBfOA2zhw7zlNs9bAakbpxFaGE';

/**
 * Generate a unique device ID for session tracking
 */
function generateDeviceId() {
  let deviceId = localStorage.getItem('DEVICE_ID');
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('DEVICE_ID', deviceId);
    console.log(`📱 New device ID created: ${deviceId}`);
  }
  return deviceId;
}

/**
 * Initialize session persistence system
 */
async function initializeSessionSync() {
  if (isInitialized) return;

  console.log('🚀 Initializing session persistence system...');

  try {
    // Create a lightweight session manager that uses device ID instead of user auth
    const deviceId = generateDeviceId();
    
    // Store sessions locally (always works)
    console.log('✅ Local session persistence enabled');

    // Attempt to sync with Supabase if available
    try {
      await syncSessionsWithSupabase(deviceId);
    } catch (error) {
      console.log('ℹ️  Supabase sync unavailable (app works offline with localStorage)');
    }

    isInitialized = true;
    console.log('✅ Session system ready - all sessions saved permanently');
  } catch (error) {
    console.error('⚠️ Session initialization error:', error);
  }
}

/**
 * Sync sessions with Supabase using device ID
 */
async function syncSessionsWithSupabase(deviceId) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  // Test connection
  const testResponse = await fetch(
    `${SUPABASE_URL_BASE}/sessions?select=count(*)&limit=1`,
    { headers }
  );

  if (!testResponse.ok) {
    throw new Error('Supabase unavailable');
  }

  console.log('✅ Supabase sync enabled');

  // Start polling for updates from other devices
  startDeviceSyncPolling(deviceId, headers);
}

/**
 * Poll for session updates from other devices
 */
function startDeviceSyncPolling(deviceId, headers) {
  let lastSyncTime = Date.now();

  setInterval(async () => {
    try {
      // Get sessions updated recently (excluding this device)
      const response = await fetch(
        `${SUPABASE_URL_BASE}/sessions?device_id=neq.${deviceId}&order=updated_at.desc&limit=100`,
        { headers }
      );

      if (!response.ok) return;

      const remoteSessions = await response.json();

      if (remoteSessions.length > 0) {
        // Merge remote sessions with local storage
        const localSessions = getStoredSessions();

        remoteSessions.forEach(remote => {
          const localVersion = localSessions[remote.case_number];

          // Use the most recent version
          if (!localVersion || new Date(remote.updated_at) > new Date(localVersion.updatedAt)) {
            localSessions[remote.case_number] = {
              caseNumber: remote.case_number,
              title: remote.title,
              createdAt: remote.created_at,
              updatedAt: remote.updated_at,
              state: remote.state,
              isActive: remote.is_active,
              deviceId: remote.device_id,
              syncedAt: new Date().toISOString()
            };
          }
        });

        setStoredSessions(localSessions);
        
        // Trigger UI refresh if session manager is open
        if (typeof renderSessionList === 'function') {
          renderSessionList();
        }

        console.log(`🔄 Synced ${remoteSessions.length} sessions from other devices`);
      }
    } catch (error) {
      // Silently fail - app continues with localStorage
    }
  }, 5000); // Poll every 5 seconds
}

/**
 * Persist session to localStorage and Supabase
 */
async function persistSession(caseNum, sessionData) {
  if (!caseNum) return;

  // Always save to localStorage first
  const sessions = getStoredSessions();
  sessions[caseNum] = {
    ...sessionData,
    syncedAt: new Date().toISOString()
  };
  setStoredSessions(sessions);

  // Try to sync to Supabase (optional)
  try {
    const deviceId = localStorage.getItem('DEVICE_ID');
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    const payload = {
      device_id: deviceId,
      case_number: caseNum,
      title: sessionData.title,
      state: sessionData.state,
      created_at: sessionData.createdAt,
      updated_at: new Date().toISOString(),
      is_active: sessionData.isActive || false
    };

    // Try upsert (insert or update)
    const response = await fetch(
      `${SUPABASE_URL_BASE}/sessions?device_id=eq.${deviceId}&case_number=eq.${caseNum}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      // If update fails, try insert
      await fetch(
        `${SUPABASE_URL_BASE}/sessions`,
        {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify(payload)
        }
      );
    }

    console.log(`✅ Session synced: ${caseNum}`);
  } catch (error) {
    // Supabase sync failed, but localStorage still has the data
    console.log(`ℹ️  Local save successful (Supabase sync failed)`);
  }
}

/**
 * Get stored sessions from localStorage
 */
function getStoredSessions() {
  try {
    return JSON.parse(localStorage.getItem('SETT_WORKSPACE_SESSIONS') || '{}') || {};
  } catch (e) {
    return {};
  }
}

/**
 * Set stored sessions in localStorage
 */
function setStoredSessions(sessions) {
  localStorage.setItem('SETT_WORKSPACE_SESSIONS', JSON.stringify(sessions));
}

/**
 * Get last active case number
 */
function getLastCaseNumber() {
  return localStorage.getItem('SETT_WORKSPACE_LAST_CASE') || '';
}

/**
 * Set last active case number
 */
function setLastCaseNumber(caseNum) {
  if (caseNum) {
    localStorage.setItem('SETT_WORKSPACE_LAST_CASE', caseNum);
  } else {
    localStorage.removeItem('SETT_WORKSPACE_LAST_CASE');
  }
}

/**
 * Enhanced saveActiveSession with automatic backend sync
 */
const originalSaveActiveSession = typeof saveActiveSession !== 'undefined' ? saveActiveSession : null;
window.saveActiveSession = async function() {
  if (originalSaveActiveSession) {
    originalSaveActiveSession.call(this);
  }

  // Also persist to backend
  const caseNum = currentCaseNumber || getLastCaseNumber();
  if (caseNum) {
    try {
      const state = typeof getAppState === 'function' ? getAppState() : {};
      await persistSession(caseNum, {
        caseNumber: caseNum,
        title: `قضية ${caseNum}`,
        state: state,
        createdAt: localStorage.getItem(`CASE_CREATED_${caseNum}`) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      });
    } catch (error) {
      console.warn('⚠️ Session sync error:', error.message);
    }
  }
};

/**
 * Enhanced scheduleSessionSave with automatic backend sync
 */
const originalScheduleSessionSave = typeof scheduleSessionSave !== 'undefined' ? scheduleSessionSave : null;
window.scheduleSessionSave = function() {
  if (originalScheduleSessionSave) {
    originalScheduleSessionSave.call(this);
  }

  // Schedule backend sync
  clearTimeout(window.backendSyncTimer);
  window.backendSyncTimer = setTimeout(async () => {
    const caseNum = currentCaseNumber || getLastCaseNumber();
    if (!caseNum) return;

    try {
      const state = typeof getAppState === 'function' ? getAppState() : {};
      await persistSession(caseNum, {
        caseNumber: caseNum,
        title: `قضية ${caseNum}`,
        state: state,
        createdAt: localStorage.getItem(`CASE_CREATED_${caseNum}`) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      });
    } catch (error) {
      console.warn('⚠️ Session auto-sync failed:', error.message);
    }
  }, 5000);
};

/**
 * Enhanced loadLastSession to restore from localStorage
 */
const originalLoadLastSession = typeof loadLastSession !== 'undefined' ? loadLastSession : null;
window.loadLastSession = async function() {
  const lastCase = getLastCaseNumber();
  if (lastCase) {
    const sessions = getStoredSessions();
    if (sessions[lastCase] && sessions[lastCase].state) {
      currentCaseNumber = lastCase;
      if (typeof applyAppState === 'function') {
        applyAppState(sessions[lastCase].state);
        console.log(`✅ Restored session: ${lastCase}`);
        return;
      }
    }
  }

  // Fallback to original
  if (originalLoadLastSession) {
    originalLoadLastSession.call(this);
  }
};

// ════════════════════════════════════════════════════════════════
// AUTO-INITIALIZATION
// ════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSessionSync);
} else {
  initializeSessionSync();
}

console.log('✅ Session persistence loaded - works offline with optional cloud sync');
