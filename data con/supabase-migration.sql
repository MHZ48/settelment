/**
 * SUPABASE MIGRATION SCRIPT
 * 
 * Execute this SQL in your Supabase database to set up the required tables
 * for session persistence and cross-device synchronization.
 * 
 * Steps:
 * 1. Go to Supabase Dashboard → SQL Editor
 * 2. Create a new query
 * 3. Copy and paste this entire file
 * 4. Run the query
 * 5. Enable RLS (Row Level Security) as needed for production
 */

-- ============================================
-- 1. CREATE AUTH USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_auth_users_email ON auth_users(email);

-- ============================================
-- 2. CREATE USER SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  last_active TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- ============================================
-- 3. CREATE SESSIONS TABLE (Case Sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  case_number TEXT NOT NULL,
  title TEXT,
  state JSONB NOT NULL,
  device_info JSONB,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  synced_at TIMESTAMP DEFAULT NOW()
);

-- Composite unique constraint: One session per user per case
CREATE UNIQUE INDEX idx_sessions_user_case ON sessions(user_id, case_number);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_case_number ON sessions(case_number);
CREATE INDEX idx_sessions_is_active ON sessions(is_active);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX idx_sessions_device_id ON sessions(device_id);

-- ============================================
-- 4. CREATE SESSION AUDIT LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS session_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'created', 'updated', 'deleted', 'restored'
  device_id TEXT,
  changed_fields JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id ON session_audit_log(user_id);
CREATE INDEX idx_audit_log_session_id ON session_audit_log(session_id);
CREATE INDEX idx_audit_log_timestamp ON session_audit_log(timestamp);

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================
-- Enable RLS
ALTER TABLE auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_audit_log ENABLE ROW LEVEL SECURITY;

-- Auth Users Policies
CREATE POLICY auth_users_self_select ON auth_users
  FOR SELECT USING (id = auth.uid()::uuid OR auth.role() = 'authenticated');

CREATE POLICY auth_users_self_update ON auth_users
  FOR UPDATE USING (id = auth.uid()::uuid);

-- User Sessions Policies
CREATE POLICY user_sessions_own_select ON user_sessions
  FOR SELECT USING (user_id = auth.uid()::uuid);

CREATE POLICY user_sessions_own_delete ON user_sessions
  FOR DELETE USING (user_id = auth.uid()::uuid);

-- Sessions Policies
CREATE POLICY sessions_own_select ON sessions
  FOR SELECT USING (user_id = auth.uid()::uuid);

CREATE POLICY sessions_own_insert ON sessions
  FOR INSERT WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY sessions_own_update ON sessions
  FOR UPDATE USING (user_id = auth.uid()::uuid);

CREATE POLICY sessions_own_delete ON sessions
  FOR DELETE USING (user_id = auth.uid()::uuid);

-- Session Audit Log Policies
CREATE POLICY audit_log_own_select ON session_audit_log
  FOR SELECT USING (user_id = auth.uid()::uuid);

-- ============================================
-- 6. HELPER FUNCTIONS
-- ============================================

-- Function to auto-update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for sessions table
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for auth_users table
CREATE TRIGGER update_auth_users_updated_at
  BEFORE UPDATE ON auth_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. CLEANUP FUNCTION (Remove Expired Sessions)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions WHERE expires_at < NOW();
  DELETE FROM sessions WHERE updated_at < NOW() - INTERVAL '180 days';
END;
$$ language 'plpgsql';

-- Schedule cleanup (optional - requires pg_cron extension):
-- SELECT cron.schedule('cleanup_expired_sessions', '0 2 * * *', 'SELECT cleanup_expired_sessions();');

-- ============================================
-- 8. VIEW FOR ACTIVE SESSIONS PER USER
-- ============================================
CREATE OR REPLACE VIEW user_active_sessions AS
SELECT 
  user_id,
  COUNT(*) as active_count,
  MAX(last_active) as last_activity,
  ARRAY_AGG(device_name) as devices
FROM user_sessions
WHERE expires_at > NOW()
GROUP BY user_id;

-- ============================================
-- 9. VIEW FOR SESSION SYNC STATUS
-- ============================================
CREATE OR REPLACE VIEW session_sync_status AS
SELECT 
  s.user_id,
  s.case_number,
  s.title,
  s.is_active,
  s.device_id,
  EXTRACT(EPOCH FROM (NOW() - s.updated_at)) as seconds_since_update,
  s.updated_at,
  s.created_at
FROM sessions s
ORDER BY s.updated_at DESC;

-- ============================================
-- 10. INITIAL COMMENTS
-- ============================================
-- 
-- Important Notes:
-- 1. For production, implement proper password hashing (bcrypt) on the backend
-- 2. Consider enabling RLS for enhanced security
-- 3. Set up regular cleanup of expired sessions
-- 4. Configure CORS and authentication rules in Supabase settings
-- 5. Monitor the session_audit_log for suspicious activity
-- 6. Test the cross-device sync functionality thoroughly
--
-- Tables Summary:
-- - auth_users: User accounts and credentials
-- - user_sessions: Active device sessions with expiry tracking
-- - sessions: Case sessions with full application state
-- - session_audit_log: Audit trail for compliance and debugging
