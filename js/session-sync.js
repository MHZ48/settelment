/**
 * Session Persistence & Cross-Device Sync Module
 * Handles persistent storage of sessions using Supabase backend
 * with real-time synchronization across authenticated devices
 */

class SessionManager {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    };
    this.userId = null;
    this.deviceId = this.generateDeviceId();
    this.localSessions = new Map(); // Client-side cache
    this.realtimeSubscriptions = [];
    this.syncInProgress = false;
    this.lastSyncTime = 0;
    this.syncInterval = 5000; // Sync every 5 seconds when changes detected
  }

  /**
   * Generate a unique device identifier
   */
  generateDeviceId() {
    let deviceId = localStorage.getItem('DEVICE_ID');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('DEVICE_ID', deviceId);
    }
    return deviceId;
  }

  /**
   * Initialize session manager with user authentication
   */
  async initialize(userId, deviceInfo = {}) {
    this.userId = userId;
    this.deviceInfo = deviceInfo;
    
    if (!userId) {
      console.warn('⚠️ Session manager initialized without user ID. Using local storage only.');
      return false;
    }

    try {
      // Ensure sessions table exists
      await this.ensureTablesExist();
      
      // Load sessions from backend
      await this.syncSessionsFromServer();
      
      // Setup real-time subscriptions
      this.setupRealtimeSubscriptions();
      
      console.log('✅ Session manager initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize session manager:', error);
      return false;
    }
  }

  /**
   * Ensure required tables exist in Supabase
   */
  async ensureTablesExist() {
    // Note: In production, run the SQL migrations separately via Supabase dashboard
    // This is a helper to check table existence
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/sessions?select=count(*) eq 0`, {
        headers: this.headers,
        method: 'HEAD'
      });
      
      if (response.status === 401) {
        throw new Error('Unauthorized: Invalid Supabase credentials');
      }
      
      return response.ok;
    } catch (error) {
      console.warn('⚠️ Unable to verify sessions table:', error.message);
      return false;
    }
  }

  /**
   * Create or update a session in the backend
   */
  async persistSession(sessionData) {
    if (!this.userId) {
      console.warn('⚠️ Not authenticated. Using local storage only.');
      this.localSessions.set(sessionData.caseNumber, sessionData);
      return sessionData;
    }

    try {
      const payload = {
        user_id: this.userId,
        device_id: this.deviceId,
        case_number: sessionData.caseNumber,
        title: sessionData.title || '',
        state: sessionData.state,
        created_at: sessionData.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        device_info: JSON.stringify(this.deviceInfo),
        is_active: sessionData.isActive || false
      };

      const response = await fetch(`${this.supabaseUrl}/rest/v1/sessions`, {
        method: 'POST',
        headers: { ...this.headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });

      if (response.status === 409) {
        // Conflict: session already exists, update instead
        return this.updateSessionBackend(sessionData);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Update local cache
      this.localSessions.set(sessionData.caseNumber, {
        ...sessionData,
        syncedAt: new Date().toISOString(),
        serverSynced: true
      });

      console.log(`✅ Session persisted: ${sessionData.caseNumber}`);
      return result[0] || sessionData;
    } catch (error) {
      console.error('❌ Failed to persist session:', error);
      // Fallback: Keep session in local cache
      this.localSessions.set(sessionData.caseNumber, sessionData);
      throw error;
    }
  }

  /**
   * Update an existing session in the backend
   */
  async updateSessionBackend(sessionData) {
    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&case_number=eq.${sessionData.caseNumber}`,
        {
          method: 'PATCH',
          headers: { ...this.headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            state: sessionData.state,
            updated_at: new Date().toISOString(),
            device_id: this.deviceId,
            device_info: JSON.stringify(this.deviceInfo),
            is_active: sessionData.isActive || false
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Update local cache
      this.localSessions.set(sessionData.caseNumber, {
        ...sessionData,
        syncedAt: new Date().toISOString(),
        serverSynced: true
      });

      console.log(`✅ Session updated: ${sessionData.caseNumber}`);
      return result[0] || sessionData;
    } catch (error) {
      console.error('❌ Failed to update session:', error);
      this.localSessions.set(sessionData.caseNumber, sessionData);
      throw error;
    }
  }

  /**
   * Load all sessions for the current user from server
   */
  async syncSessionsFromServer() {
    if (!this.userId) return [];

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&order=updated_at.desc`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const sessions = await response.json();
      
      // Update local cache
      sessions.forEach(session => {
        this.localSessions.set(session.case_number, {
          caseNumber: session.case_number,
          title: session.title,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          state: session.state,
          isActive: session.is_active,
          deviceId: session.device_id,
          syncedAt: new Date().toISOString(),
          serverSynced: true
        });
      });

      console.log(`✅ Synced ${sessions.length} sessions from server`);
      this.lastSyncTime = Date.now();
      return sessions;
    } catch (error) {
      console.error('❌ Failed to sync sessions from server:', error);
      return [];
    }
  }

  /**
   * Restore the last active session
   */
  async restoreLastActiveSession() {
    if (!this.userId) return null;

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&is_active=eq.true&limit=1`,
        { headers: this.headers }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const sessions = await response.json();
      const session = sessions[0];

      if (session) {
        // Update local cache
        this.localSessions.set(session.case_number, {
          caseNumber: session.case_number,
          title: session.title,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          state: session.state,
          isActive: true,
          syncedAt: new Date().toISOString(),
          serverSynced: true
        });
        
        console.log(`✅ Restored last active session: ${session.case_number}`);
        return session;
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to restore last active session:', error);
      return null;
    }
  }

  /**
   * Mark a session as active (for syncing across devices)
   */
  async markSessionActive(caseNumber) {
    if (!this.userId) {
      localStorage.setItem('ACTIVE_SESSION', caseNumber);
      return;
    }

    try {
      // First, deactivate all other sessions
      await fetch(
        `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&case_number=neq.${caseNumber}`,
        {
          method: 'PATCH',
          headers: this.headers,
          body: JSON.stringify({ is_active: false })
        }
      );

      // Then activate this session
      await fetch(
        `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&case_number=eq.${caseNumber}`,
        {
          method: 'PATCH',
          headers: this.headers,
          body: JSON.stringify({
            is_active: true,
            device_id: this.deviceId,
            updated_at: new Date().toISOString()
          })
        }
      );

      // Update local cache
      this.localSessions.forEach((session) => {
        session.isActive = (session.caseNumber === caseNumber);
      });

      console.log(`✅ Marked session as active: ${caseNumber}`);
    } catch (error) {
      console.error('❌ Failed to mark session as active:', error);
    }
  }

  /**
   * Get a session from local cache (immediate)
   */
  getLocalSession(caseNumber) {
    return this.localSessions.get(caseNumber) || null;
  }

  /**
   * Get all local sessions
   */
  getAllLocalSessions() {
    return Array.from(this.localSessions.values());
  }

  /**
   * Delete a session
   */
  async deleteSession(caseNumber) {
    if (!this.userId) {
      this.localSessions.delete(caseNumber);
      return true;
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&case_number=eq.${caseNumber}`,
        { method: 'DELETE', headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.localSessions.delete(caseNumber);
      console.log(`✅ Session deleted: ${caseNumber}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to delete session:', error);
      return false;
    }
  }

  /**
   * Setup real-time subscriptions for cross-device updates
   */
  setupRealtimeSubscriptions() {
    if (!this.userId) return;

    // Note: Supabase realtime subscriptions require the Supabase JavaScript client library
    // This is a placeholder for integration with PostgREST subscriptions via polling
    console.log('⏱️  Setting up real-time sync polling (5s interval)');
    
    // Implement polling for real-time updates
    this.startRealtimePolling();
  }

  /**
   * Start polling for changes from other devices
   */
  startRealtimePolling() {
    if (!this.userId) return;

    setInterval(async () => {
      if (this.syncInProgress) return;
      
      try {
        this.syncInProgress = true;
        
        const response = await fetch(
          `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}&updated_at=gt.${new Date(this.lastSyncTime).toISOString()}`,
          { headers: this.headers }
        );

        if (!response.ok) return;

        const updatedSessions = await response.json();
        
        if (updatedSessions.length > 0) {
          updatedSessions.forEach(session => {
            // Skip if update is from current device
            if (session.device_id !== this.deviceId) {
              this.localSessions.set(session.case_number, {
                caseNumber: session.case_number,
                title: session.title,
                createdAt: session.created_at,
                updatedAt: session.updated_at,
                state: session.state,
                isActive: session.is_active,
                deviceId: session.device_id,
                syncedAt: new Date().toISOString(),
                serverSynced: true,
                fromOtherDevice: true
              });
            }
          });

          // Trigger update event for UI refresh
          this.dispatchSyncEvent('sessions-updated', updatedSessions);
          console.log(`✅ Synced ${updatedSessions.length} updates from other devices`);
        }

        this.lastSyncTime = Date.now();
      } catch (error) {
        console.error('⚠️ Real-time sync polling error:', error);
      } finally {
        this.syncInProgress = false;
      }
    }, this.syncInterval);
  }

  /**
   * Dispatch custom events for UI to listen to
   */
  dispatchSyncEvent(eventName, data) {
    window.dispatchEvent(
      new CustomEvent(`session:${eventName}`, { detail: data })
    );
  }

  /**
   * Export all sessions as JSON (for backup)
   */
  exportSessions() {
    const sessions = this.getAllLocalSessions();
    return JSON.stringify(sessions, null, 2);
  }

  /**
   * Import sessions from JSON (for restore)
   */
  async importSessions(jsonData) {
    try {
      const sessions = JSON.parse(jsonData);
      let imported = 0;

      for (const session of sessions) {
        if (session.caseNumber && session.state) {
          await this.persistSession(session);
          imported++;
        }
      }

      console.log(`✅ Imported ${imported} sessions`);
      return imported;
    } catch (error) {
      console.error('❌ Failed to import sessions:', error);
      return 0;
    }
  }

  /**
   * Clear all sessions (destructive)
   */
  async clearAllSessions() {
    if (!confirm('⚠️ This will delete ALL sessions. Continue?')) return false;

    try {
      if (this.userId) {
        await fetch(
          `${this.supabaseUrl}/rest/v1/sessions?user_id=eq.${this.userId}`,
          { method: 'DELETE', headers: this.headers }
        );
      }

      this.localSessions.clear();
      console.log('✅ All sessions cleared');
      return true;
    } catch (error) {
      console.error('❌ Failed to clear sessions:', error);
      return false;
    }
  }

  /**
   * Get sync status information
   */
  getSyncStatus() {
    return {
      userId: this.userId,
      deviceId: this.deviceId,
      localSessionCount: this.localSessions.size,
      lastSyncTime: new Date(this.lastSyncTime).toISOString(),
      isOnline: navigator.onLine,
      syncInProgress: this.syncInProgress
    };
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.SessionManager = SessionManager;
}
