/**
 * Session Sync Integration
 * Enables persistent session storage with optional cross-device synchronization
 * 
 * ✅ Works WITHOUT login - uses localStorage for persistence
 * ✅ Optionally sync across devices when authenticated
 * ✅ Seamless fallback to localStorage if backend unavailable
 * ✅ No breaking changes to existing functionality
 */

// ════════════════════════════════════════════════════════════════
// GLOBAL SESSION & AUTH MANAGERS
// ════════════════════════════════════════════════════════════════
let authManager = null;
let sessionManager = null;
let isInitialized = false;

const SUPABASE_URL_BASE = 'https://dwhckbcrlgjesxniqmmr.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3aGNrYmNybGdqZXN4bmlxbW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTI5MDMsImV4cCI6MjA5MDkyODkwM30.8rkrHvEUttojlRwR1mBfOA2zhw7zlNs9bAakbpxFaGE';

// ════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════

/**
 * Initialize the entire session & auth system
 * Authentication is OPTIONAL - app works with or without login
 */
async function initializeSessionSync() {
  if (isInitialized) return;

  console.log('🚀 Initializing session system (authentication optional)...');

  try {
    // Initialize auth manager (but don't require it)
    authManager = new AuthManager(SUPABASE_URL_BASE, SUPABASE_KEY);
    console.log('✅ Auth manager initialized (optional)');

    // Check if user is already logged in
    if (authManager.isAuthenticated()) {
      console.log(`✅ User already logged in: ${authManager.getCurrentUser().email}`);
      await initializeSessionManager();
      updateUIForAuthenticatedUser();
    } else {
      console.log('ℹ️ Using local storage persistence (not logged in)');
      updateUIForGuest();
    }

    // Start session refresh timer only if authenticated
    if (authManager.isAuthenticated()) {
      authManager.startSessionRefresh();
    }

    // Listen for session sync events
    listenForSessionSyncEvents();

    isInitialized = true;
    console.log('✅ Session system ready (localStorage enabled)');
  } catch (error) {
    console.error('⚠️ Optional: Failed to initialize auth manager:', error);
    console.log('ℹ️ Continuing with localStorage-only persistence');
    isInitialized = true;
  }
}

/**
 * Initialize session manager after authentication
 */
async function initializeSessionManager() {
  if (!authManager.isAuthenticated()) {
    console.warn('⚠️ Cannot initialize session manager: not authenticated');
    return false;
  }

  try {
    const user = authManager.getCurrentUser();
    sessionManager = new SessionManager(SUPABASE_URL_BASE, SUPABASE_KEY);

    const success = await sessionManager.initialize(user.id, {
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    if (success) {
      console.log('✅ Session manager initialized');

      // Restore last active session
      const lastSession = await sessionManager.restoreLastActiveSession();
      if (lastSession && lastSession.state) {
        console.log(`📂 Restoring session: ${lastSession.case_number}`);
        if (typeof applyAppState === 'function') {
          applyAppState(lastSession.state);
          currentCaseNumber = lastSession.case_number;
          setLastCaseNumber(lastSession.case_number);
        }
      }

      // Start real-time sync
      showSyncStatus();
      return true;
    } else {
      console.warn('⚠️ Session manager initialization failed, falling back to local storage');
      return false;
    }
  } catch (error) {
    console.error('❌ Session manager initialization error:', error);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════
// AUTHENTICATION UI HANDLERS
// ════════════════════════════════════════════════════════════════

/**
 * Open authentication modal
 */
function openAuthModal() {
  if (authManager && authManager.isAuthenticated()) {
    // Show device management UI
    showDeviceManagement();
  } else {
    // Show login/signup UI
    showAuthForm();
  }
  document.getElementById('auth-modal').classList.add('open');
}

/**
 * Close authentication modal
 */
function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('open');
}

/**
 * Toggle between login and signup modes
 */
function toggleAuthMode() {
  const isSignup = document.getElementById('auth-name-field').style.display !== 'none';
  const title = document.getElementById('auth-title');
  const btn = document.getElementById('auth-btn');
  const toggleText = document.getElementById('auth-toggle-text');

  if (isSignup) {
    // Switch to login
    document.getElementById('auth-name-field').style.display = 'none';
    title.textContent = 'تسجيل الدخول';
    btn.textContent = 'تسجيل الدخول';
    toggleText.textContent = 'ليس لديك حساب؟';
  } else {
    // Switch to signup
    document.getElementById('auth-name-field').style.display = 'block';
    title.textContent = 'إنشاء حساب';
    btn.textContent = 'إنشاء حساب';
    toggleText.textContent = 'لديك حساب بالفعل؟';
  }
}

/**
 * Handle authentication form submission
 */
async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value.trim();
  const isSignup = document.getElementById('auth-name-field').style.display !== 'none';
  const errorDiv = document.getElementById('auth-error');
  const btn = document.getElementById('auth-btn');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';

  if (!email || !password) {
    errorDiv.textContent = 'الرجاء ملء جميع الحقول المطلوبة';
    errorDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'جاري المعالجة...';

  try {
    if (isSignup) {
      await authManager.register(email, password, name);
    } else {
      await authManager.loginWithCredentials(email, password);
    }

    // Initialize session manager
    await initializeSessionManager();

    // Update UI
    updateUIForAuthenticatedUser();

    // Close modal
    closeAuthModal();

    // Show success message
    alert(`✅ ${isSignup ? 'تم إنشاء الحساب' : 'تم تسجيل الدخول'} بنجاح!`);
  } catch (error) {
    errorDiv.textContent = `❌ خطأ: ${error.message}`;
    errorDiv.style.display = 'block';
    console.error('Auth error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = isSignup ? 'إنشاء حساب' : 'تسجيل الدخول';
  }
}

/**
 * Logout user
 */
async function logout() {
  if (!confirm('هل تريد تسجيل الخروج؟')) return;

  try {
    await authManager.logout();
    sessionManager = null;
    updateUIForGuest();
    alert('✅ تم تسجيل الخروج بنجاح');
  } catch (error) {
    console.error('❌ Logout error:', error);
  }
}

// ════════════════════════════════════════════════════════════════
// DEVICE MANAGEMENT UI
// ════════════════════════════════════════════════════════════════

/**
 * Show device management interface
 */
async function showDeviceManagement() {
  const authForm = document.getElementById('auth-form');
  const devicesDiv = document.getElementById('auth-devices');
  const devicesList = document.getElementById('devices-list');

  authForm.style.display = 'none';
  devicesDiv.style.display = 'block';

  try {
    const sessions = await authManager.getActiveSessions();

    if (sessions.length === 0) {
      devicesList.innerHTML = '<div style="color:var(--dim);font-size:11px">لا توجد أجهزة نشطة</div>';
      return;
    }

    devicesList.innerHTML = sessions.map(session => `
      <div class="device-item">
        <div class="device-item-info">
          <div style="font-weight:bold;margin-bottom:2px">${session.device_name || 'جهاز'}</div>
          <div style="font-size:10px;color:var(--dim)">آخر نشاط: ${new Date(session.last_active).toLocaleString('ar')}</div>
        </div>
        <button onclick="logoutDevice('${session.id}')">تسجيل الخروج</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error fetching sessions:', error);
    devicesList.innerHTML = '<div style="color:#f85149;font-size:11px">خطأ في تحميل الأجهزة</div>';
  }
}

/**
 * Show authentication form
 */
function showAuthForm() {
  document.getElementById('auth-form').style.display = 'block';
  document.getElementById('auth-devices').style.display = 'none';
}

/**
 * Logout specific device
 */
async function logoutDevice(sessionId) {
  if (!confirm('هل تريد تسجيل الخروج من هذا الجهاز؟')) return;

  try {
    await authManager.logoutDevice(sessionId);
    await showDeviceManagement();
    alert('✅ تم تسجيل الخروج من الجهاز');
  } catch (error) {
    console.error('Error logging out device:', error);
  }
}

// ════════════════════════════════════════════════════════════════
// UI UPDATES
// ════════════════════════════════════════════════════════════════

/**
 * Update UI for authenticated user (show sync features)
 */
function updateUIForAuthenticatedUser() {
  const user = authManager.getCurrentUser();
  const authBtn = document.getElementById('auth-status-btn');
  const userInfo = document.getElementById('user-info');
  const userEmail = document.getElementById('user-email');

  if (authBtn) {
    authBtn.style.display = 'none';
  }
  if (userInfo) {
    userInfo.style.display = 'flex';
    userEmail.textContent = user.email;
  }

  showSyncStatus();
  console.log('👤 User authenticated - sync features enabled');
}

/**
 * Update UI for guest (hide sync features, show login button)
 */
function updateUIForGuest() {
  const authBtn = document.getElementById('auth-status-btn');
  const userInfo = document.getElementById('user-info');

  if (authBtn) {
    authBtn.style.display = 'flex';
    authBtn.textContent = '🔓 دخول';
  }
  if (userInfo) {
    userInfo.style.display = 'none';
  }

  hideSyncStatus();
  console.log('👥 Guest mode - using localStorage for persistence');
}

// ════════════════════════════════════════════════════════════════
// SYNC STATUS DISPLAY
// ════════════════════════════════════════════════════════════════

/**
 * Show sync status indicator (only when authenticated)
 */
function showSyncStatus() {
  const statusDiv = document.getElementById('sync-status');
  if (!statusDiv || !authManager || !authManager.isAuthenticated()) {
    return; // Only show when authenticated
  }

  statusDiv.style.display = 'block';

  if (navigator.onLine) {
    statusDiv.classList.remove('offline');
    statusDiv.classList.add('online');
    document.getElementById('sync-indicator').classList.add('syncing');
    document.getElementById('sync-text').textContent = 'متزامن';
  } else {
    statusDiv.classList.remove('online');
    statusDiv.classList.add('offline');
    document.getElementById('sync-indicator').classList.remove('syncing');
    document.getElementById('sync-text').textContent = 'غير متصل';
  }
}

/**
 * Hide sync status indicator
 */
function hideSyncStatus() {
  const statusDiv = document.getElementById('sync-status');
  if (statusDiv) {
    statusDiv.style.display = 'none';
  }
}

/**
 * Display detailed sync status (only when authenticated)
 */
function showDetailedSyncStatus() {
  if (!sessionManager || !authManager.isAuthenticated()) return;

  const status = sessionManager.getSyncStatus();
  console.log('📊 Sync Status:', status);

  const statusDiv = document.getElementById('sync-status');
  if (!statusDiv) return;

  statusDiv.onclick = () => {
    alert(`📊 حالة المزامنة:\n\n` +
          `المستخدم: ${status.userId || 'غير مصرح'}\n` +
          `الجهاز: ${status.deviceId}\n` +
          `الجلسات المحلية: ${status.localSessionCount}\n` +
          `آخر تزامن: ${new Date(status.lastSyncTime).toLocaleString('ar')}\n` +
          `الاتصال: ${status.isOnline ? '✅ متصل' : '❌ غير متصل'}`);
  };
}

// ════════════════════════════════════════════════════════════════
// SESSION SYNC EVENT LISTENERS
// ════════════════════════════════════════════════════════════════

/**
 * Listen for cross-device session sync events
 */
function listenForSessionSyncEvents() {
  if (!sessionManager) return;

  // Listen for remote session updates
  window.addEventListener('session:sessions-updated', (event) => {
    console.log('🔄 Sessions updated from other devices:', event.detail);

    const updatedSessions = event.detail;
    updatedSessions.forEach(session => {
      if (session.is_active && session.device_id !== sessionManager.deviceId) {
        // Another device activated a different session
        console.log(`📲 Device ${session.device_id} activated: ${session.case_number}`);

        // Optionally show notification
        if (Notification && Notification.permission === 'granted') {
          new Notification('جلسة جديدة على جهاز آخر', {
            body: `تم تفعيل الجلسة: ${session.case_number}`,
            icon: '📂'
          });
        }
      }
    });

    // Re-render session list if it's open
    if (typeof renderSessionList === 'function') {
      renderSessionList();
    }
  });

  // Listen for offline/online events
  window.addEventListener('online', () => {
    console.log('✅ Back online');
    showSyncStatus();
    if (sessionManager) {
      sessionManager.syncSessionsFromServer();
    }
  });

  window.addEventListener('offline', () => {
    console.log('⚠️ Offline');
    showSyncStatus();
  });
}

// ════════════════════════════════════════════════════════════════
// SESSION PERSISTENCE ENHANCEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Override the original saveActiveSession to also persist to backend if authenticated
 * Falls back to localStorage if not authenticated
 */
const originalSaveActiveSession = typeof saveActiveSession !== 'undefined' ? saveActiveSession : null;
window.saveActiveSession = async function() {
  // Always save locally first
  if (originalSaveActiveSession) {
    originalSaveActiveSession.call(this);
  }

  // Then, persist to backend ONLY if authenticated and session manager ready
  if (authManager && authManager.isAuthenticated() && sessionManager) {
    const caseNum = currentCaseNumber || getLastCaseNumber();
    if (!caseNum) return;

    try {
      const state = typeof getAppState === 'function' ? getAppState() : {};
      await sessionManager.persistSession({
        caseNumber: caseNum,
        title: `قضية ${caseNum}`,
        state: state,
        isActive: true
      });
      console.log(`✅ Session synced to backend: ${caseNum}`);
    } catch (error) {
      console.warn('⚠️ Backend sync failed (using localStorage only):', error.message);
      // App continues to work with localStorage
    }
  }
};

/**
 * Override the original scheduleSessionSave to include optional backend sync
 * Falls back to localStorage if not authenticated
 */
const originalScheduleSessionSave = typeof scheduleSessionSave !== 'undefined' ? scheduleSessionSave : null;
window.scheduleSessionSave = function() {
  // Always call original (localStorage)
  if (originalScheduleSessionSave) {
    originalScheduleSessionSave.call(this);
  }

  // Also schedule backend sync ONLY if authenticated
  if (authManager && authManager.isAuthenticated() && sessionManager) {
    clearTimeout(window.backendSyncTimer);
    window.backendSyncTimer = setTimeout(async () => {
      const caseNum = currentCaseNumber || getLastCaseNumber();
      if (!caseNum) return;

      try {
        const state = typeof getAppState === 'function' ? getAppState() : {};
        await sessionManager.persistSession({
          caseNumber: caseNum,
          title: `قضية ${caseNum}`,
          state: state,
          isActive: true
        });
      } catch (error) {
        console.warn('⚠️ Backend sync failed (localStorage still working):', error.message);
      }
    }, 5000);
  }
};

/**
 * Override loadLastSession to restore from backend if authenticated, 
 * otherwise use localStorage
 */
const originalLoadLastSession = typeof loadLastSession !== 'undefined' ? loadLastSession : null;
window.loadLastSession = async function() {
  // If authenticated, try to restore from backend first
  if (authManager && authManager.isAuthenticated() && sessionManager) {
    try {
      const lastSession = await sessionManager.restoreLastActiveSession();
      if (lastSession && lastSession.state) {
        currentCaseNumber = lastSession.case_number;
        if (typeof applyAppState === 'function') {
          applyAppState(lastSession.state);
          console.log('✅ Restored session from backend');
        }
        return;
      }
    } catch (error) {
      console.warn('⚠️ Backend restore failed, falling back to localStorage:', error.message);
    }
  }

  // Always fall back to localStorage (works offline or when not authenticated)
  if (originalLoadLastSession) {
    originalLoadLastSession.call(this);
  }
};

// ════════════════════════════════════════════════════════════════
// AUTO-INITIALIZATION
// ════════════════════════════════════════════════════════════════

// Initialize on document ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSessionSync);
} else {
  initializeSessionSync();
}

// Request notification permission if online
if ('Notification' in window && Notification.permission === 'default') {
  setTimeout(() => {
    Notification.requestPermission();
  }, 2000);
}

console.log('✅ Session system loaded - localStorage enabled (login optional)');
