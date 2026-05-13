/**
 * Authentication Module
 * Handles user registration, login, logout, and device verification
 */

class AuthManager {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    };
    this.currentUser = null;
    this.sessionToken = null;
    this.loadStoredAuth();
  }

  /**
   * Load authentication from local storage
   */
  loadStoredAuth() {
    try {
      const stored = localStorage.getItem('SETT_USER_AUTH');
      if (stored) {
        const auth = JSON.parse(stored);
        // Verify token is still valid (not expired)
        if (auth.sessionToken && auth.expiresAt && new Date(auth.expiresAt) > new Date()) {
          this.currentUser = auth.user;
          this.sessionToken = auth.sessionToken;
          console.log(`✅ Restored session for user: ${auth.user.email}`);
          return true;
        } else {
          localStorage.removeItem('SETT_USER_AUTH');
        }
      }
    } catch (error) {
      console.error('⚠️ Failed to load stored auth:', error);
      localStorage.removeItem('SETT_USER_AUTH');
    }
    return false;
  }

  /**
   * Register a new user
   */
  async register(email, password, displayName = '') {
    try {
      if (!this.validateEmail(email)) {
        throw new Error('Invalid email format');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      const response = await fetch(`${this.supabaseUrl}/rest/v1/auth_users`, {
        method: 'POST',
        headers: { ...this.headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          email: email.toLowerCase(),
          password: this.hashPassword(password),
          display_name: displayName || email.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });

      if (response.status === 409) {
        throw new Error('Email already registered. Please login instead.');
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const user = result[0];

      // Auto-login after registration
      return this.loginWithCredentials(email, password);
    } catch (error) {
      console.error('❌ Registration failed:', error);
      throw error;
    }
  }

  /**
   * Login with email and password
   */
  async loginWithCredentials(email, password) {
    try {
      if (!this.validateEmail(email)) {
        throw new Error('Invalid email format');
      }

      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/auth_users?email=eq.${encodeURIComponent(email.toLowerCase())}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error('Unable to verify credentials');
      }

      const users = await response.json();
      const user = users[0];

      if (!user) {
        throw new Error('Email not found. Please register first.');
      }

      // Simple password verification (in production, use bcrypt on backend)
      if (!this.verifyPassword(password, user.password_hash)) {
        throw new Error('Invalid password');
      }

      return this.createSession(user);
    } catch (error) {
      console.error('❌ Login failed:', error);
      throw error;
    }
  }

  /**
   * Create a new session token
   */
  async createSession(user) {
    try {
      const sessionToken = this.generateSessionToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30-day session

      const sessionData = {
        user_id: user.id,
        token: sessionToken,
        device_id: localStorage.getItem('DEVICE_ID') || this.generateDeviceId(),
        device_name: this.getDeviceName(),
        created_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      };

      // Store session in backend
      await fetch(`${this.supabaseUrl}/rest/v1/user_sessions`, {
        method: 'POST',
        headers: { ...this.headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify(sessionData)
      });

      // Store in local storage
      const authData = {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name
        },
        sessionToken,
        expiresAt: expiresAt.toISOString()
      };

      localStorage.setItem('SETT_USER_AUTH', JSON.stringify(authData));
      this.currentUser = authData.user;
      this.sessionToken = sessionToken;

      console.log(`✅ Login successful: ${user.email}`);
      return {
        success: true,
        user: this.currentUser
      };
    } catch (error) {
      console.error('❌ Session creation failed:', error);
      throw error;
    }
  }

  /**
   * Logout and clear session
   */
  async logout() {
    try {
      if (this.sessionToken && this.currentUser) {
        // Invalidate session on server
        await fetch(
          `${this.supabaseUrl}/rest/v1/user_sessions?token=eq.${this.sessionToken}`,
          { method: 'DELETE', headers: this.headers }
        ).catch(() => {}); // Ignore errors
      }

      localStorage.removeItem('SETT_USER_AUTH');
      this.currentUser = null;
      this.sessionToken = null;

      console.log('✅ Logged out successfully');
      return true;
    } catch (error) {
      console.error('⚠️ Logout error:', error);
      localStorage.removeItem('SETT_USER_AUTH');
      this.currentUser = null;
      return false;
    }
  }

  /**
   * Verify session token is still valid
   */
  async verifySession() {
    if (!this.sessionToken || !this.currentUser) {
      return false;
    }

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/user_sessions?token=eq.${this.sessionToken}&select=*`,
        { headers: this.headers }
      );

      if (!response.ok) return false;

      const sessions = await response.json();
      const session = sessions[0];

      if (!session) {
        this.logout();
        return false;
      }

      // Check if session is expired
      if (new Date(session.expires_at) < new Date()) {
        this.logout();
        return false;
      }

      return true;
    } catch (error) {
      console.error('⚠️ Session verification error:', error);
      return false;
    }
  }

  /**
   * Get all active sessions for current user
   */
  async getActiveSessions() {
    if (!this.currentUser) return [];

    try {
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/user_sessions?user_id=eq.${this.currentUser.id}&expires_at=gt.now()`,
        { headers: this.headers }
      );

      if (!response.ok) return [];

      const sessions = await response.json();
      return sessions;
    } catch (error) {
      console.error('⚠️ Failed to fetch active sessions:', error);
      return [];
    }
  }

  /**
   * Logout from a specific device
   */
  async logoutDevice(sessionId) {
    try {
      await fetch(
        `${this.supabaseUrl}/rest/v1/user_sessions?id=eq.${sessionId}`,
        { method: 'DELETE', headers: this.headers }
      );
      console.log(`✅ Device session terminated: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to logout device:', error);
      return false;
    }
  }

  /**
   * Change user password
   */
  async changePassword(currentPassword, newPassword) {
    if (!this.currentUser) {
      throw new Error('Not authenticated');
    }

    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    try {
      // Verify current password
      const loginResult = await this.loginWithCredentials(
        this.currentUser.email,
        currentPassword
      );

      if (!loginResult.success) {
        throw new Error('Current password is incorrect');
      }

      // Update password
      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/auth_users?id=eq.${this.currentUser.id}`,
        {
          method: 'PATCH',
          headers: this.headers,
          body: JSON.stringify({
            password_hash: this.hashPassword(newPassword),
            updated_at: new Date().toISOString()
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to update password`);
      }

      console.log('✅ Password changed successfully');
      return true;
    } catch (error) {
      console.error('❌ Password change failed:', error);
      throw error;
    }
  }

  /**
   * Validate email format
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Simple password hashing (SHA256) - for demo purposes
   * In production, use bcrypt on the backend
   */
  hashPassword(password) {
    // This is a placeholder - implement proper hashing on the backend
    return btoa(password); // Base64 encoding for demo only
  }

  /**
   * Verify hashed password
   */
  verifyPassword(password, hash) {
    return this.hashPassword(password) === hash;
  }

  /**
   * Generate session token
   */
  generateSessionToken() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate device ID
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
   * Get device name for identification
   */
  getDeviceName() {
    const ua = navigator.userAgent;
    let deviceName = 'Unknown Device';

    if (/Windows/.test(ua)) deviceName = 'Windows PC';
    else if (/Macintosh/.test(ua)) deviceName = 'Mac';
    else if (/iPhone/.test(ua)) deviceName = 'iPhone';
    else if (/iPad/.test(ua)) deviceName = 'iPad';
    else if (/Android/.test(ua)) deviceName = 'Android Device';
    else if (/Linux/.test(ua)) deviceName = 'Linux';

    return deviceName;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.currentUser && !!this.sessionToken;
  }

  /**
   * Get current user info
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Automatically refresh session if expiring soon
   */
  startSessionRefresh() {
    setInterval(async () => {
      if (!this.isAuthenticated()) return;

      try {
        const isValid = await this.verifySession();
        if (!isValid) {
          console.warn('⚠️ Session expired');
          this.logout();
        }
      } catch (error) {
        console.error('⚠️ Session refresh error:', error);
      }
    }, 60000); // Check every minute
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.AuthManager = AuthManager;
}
