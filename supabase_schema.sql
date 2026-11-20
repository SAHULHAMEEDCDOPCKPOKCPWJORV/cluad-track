-- ==============================================================================
-- SWELECT ENERGY SYSTEMS LIMITED - Project Planning & Control Platform
-- Supabase Cloud Database Schema
-- Target Project: https://supabase.com/dashboard/project/jdbehquxpudsfbqtlmbq
-- ==============================================================================

-- 1. SWELECT PROJECTS TABLE
CREATE TABLE IF NOT EXISTS swelect_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    capacity_mw NUMERIC DEFAULT 0,
    project_type TEXT DEFAULT 'Solar EPC',
    state TEXT DEFAULT 'Tamil Nadu',
    district TEXT DEFAULT '',
    village TEXT DEFAULT '',
    planned_start_date TEXT,
    planned_end_date TEXT,
    actual_start_date TEXT,
    actual_end_date TEXT,
    description TEXT,
    status TEXT DEFAULT 'In Progress',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SWELECT MASTER ACTIVITIES TABLE (165+ Work Packages)
CREATE TABLE IF NOT EXISTS swelect_activities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES swelect_projects(id) ON DELETE CASCADE,
    s_no INTEGER,
    activity_id TEXT NOT NULL,
    activity_name TEXT NOT NULL,
    section TEXT NOT NULL,
    department TEXT NOT NULL,
    planned_duration NUMERIC DEFAULT 0,
    planned_start_date TEXT,
    planned_end_date TEXT,
    actual_duration NUMERIC,
    actual_start_date TEXT,
    actual_end_date TEXT,
    progress_percent NUMERIC DEFAULT 0,
    weightage NUMERIC DEFAULT 0,
    is_milestone BOOLEAN DEFAULT FALSE,
    delay_days INTEGER DEFAULT 0,
    delay_label TEXT DEFAULT '0',
    status TEXT DEFAULT 'Not Started',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT DEFAULT 'system'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activities_project_id ON swelect_activities(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_section ON swelect_activities(section);
CREATE INDEX IF NOT EXISTS idx_activities_status ON swelect_activities(status);

-- 3. SWELECT INDIAN HOLIDAYS & CALENDAR TABLE
CREATE TABLE IF NOT EXISTS swelect_holidays (
    date TEXT PRIMARY KEY, -- YYYY-MM-DD
    name TEXT NOT NULL,
    type TEXT DEFAULT 'National'
);

-- 4. SWELECT AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS swelect_audit_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT,
    user_id TEXT,
    user_email TEXT,
    department TEXT,
    action TEXT NOT NULL,
    activity_id TEXT,
    activity_name TEXT,
    field_name TEXT,
    old_value TEXT,
    newValue TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON swelect_audit_logs(project_id);

-- 5. SWELECT USERS TABLE
CREATE TABLE IF NOT EXISTS swelect_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    department TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    can_edit BOOLEAN DEFAULT TRUE,
    can_export BOOLEAN DEFAULT TRUE,
    can_approve BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ENABLE ROW LEVEL SECURITY (RLS) with open read/write policies for SWELECT App
ALTER TABLE swelect_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE swelect_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE swelect_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE swelect_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE swelect_users ENABLE ROW LEVEL SECURITY;

-- Allow anonymous and authenticated read/write
DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow all access to swelect_projects" ON swelect_projects;
    CREATE POLICY "Allow all access to swelect_projects" ON swelect_projects FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow all access to swelect_activities" ON swelect_activities;
    CREATE POLICY "Allow all access to swelect_activities" ON swelect_activities FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow all access to swelect_holidays" ON swelect_holidays;
    CREATE POLICY "Allow all access to swelect_holidays" ON swelect_holidays FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow all access to swelect_audit_logs" ON swelect_audit_logs;
    CREATE POLICY "Allow all access to swelect_audit_logs" ON swelect_audit_logs FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow all access to swelect_users" ON swelect_users;
    CREATE POLICY "Allow all access to swelect_users" ON swelect_users FOR ALL USING (true) WITH CHECK (true);
END
$$;
