-- ==============================================================================
-- SAMARPIT IRANIWADI - PostgreSQL Schema for Supabase
-- 100% Free Tier Compatible (Runs in Supabase SQL Editor in 1 click)
-- ==============================================================================

-- 1. Enable UUID Extension (built into PostgreSQL)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create 'children' (Bhulku) Table
CREATE TABLE IF NOT EXISTS public.children (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cls TEXT,
    age INTEGER,
    hobby TEXT,
    phone TEXT,
    address TEXT,
    food TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create 'sabhas' Table
CREATE TABLE IF NOT EXISTS public.sabhas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    topic TEXT NOT NULL,
    host TEXT,
    recap TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create 'attendance' Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sabha_id UUID NOT NULL REFERENCES public.sabhas(id) ON DELETE CASCADE,
    child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
    status SMALLINT NOT NULL DEFAULT 1, -- 1: Present, 0: Absent
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_sabha_child_att UNIQUE (sabha_id, child_id)
);

-- 5. Indexes for High Performance
CREATE INDEX IF NOT EXISTS idx_children_name ON public.children(name);
CREATE INDEX IF NOT EXISTS idx_sabhas_date ON public.sabhas(date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_sabha_id ON public.attendance(sabha_id);
CREATE INDEX IF NOT EXISTS idx_attendance_child_id ON public.attendance(child_id);

-- 6. Real-time updates trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_children_updated_at ON public.children;
CREATE TRIGGER set_children_updated_at
    BEFORE UPDATE ON public.children
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_sabhas_updated_at ON public.sabhas;
CREATE TRIGGER set_sabhas_updated_at
    BEFORE UPDATE ON public.sabhas
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_attendance_updated_at ON public.attendance;
CREATE TRIGGER set_attendance_updated_at
    BEFORE UPDATE ON public.attendance
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sabhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies: Allow authenticated users (signed in via Google OAuth) full CRUD access
DROP POLICY IF EXISTS "Authenticated users can select children" ON public.children;
DROP POLICY IF EXISTS "Authenticated users can insert children" ON public.children;
DROP POLICY IF EXISTS "Authenticated users can update children" ON public.children;
DROP POLICY IF EXISTS "Authenticated users can delete children" ON public.children;

CREATE POLICY "Authenticated users can select children"
    ON public.children FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert children"
    ON public.children FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update children"
    ON public.children FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can delete children"
    ON public.children FOR DELETE
    TO authenticated
    USING (true);

-- Sabhas policies
DROP POLICY IF EXISTS "Authenticated users can select sabhas" ON public.sabhas;
DROP POLICY IF EXISTS "Authenticated users can insert sabhas" ON public.sabhas;
DROP POLICY IF EXISTS "Authenticated users can update sabhas" ON public.sabhas;
DROP POLICY IF EXISTS "Authenticated users can delete sabhas" ON public.sabhas;

CREATE POLICY "Authenticated users can select sabhas"
    ON public.sabhas FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert sabhas"
    ON public.sabhas FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update sabhas"
    ON public.sabhas FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can delete sabhas"
    ON public.sabhas FOR DELETE
    TO authenticated
    USING (true);

-- Attendance policies
DROP POLICY IF EXISTS "Authenticated users can select attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated users can insert attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated users can update attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated users can delete attendance" ON public.attendance;

CREATE POLICY "Authenticated users can select attendance"
    ON public.attendance FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert attendance"
    ON public.attendance FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update attendance"
    ON public.attendance FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can delete attendance"
    ON public.attendance FOR DELETE
    TO authenticated
    USING (true);

-- 9. Create 'app_users' Table (Administrators and Allowance Requests)
CREATE TABLE IF NOT EXISTS public.app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'viewer', -- 'admin', 'viewer'
    status TEXT NOT NULL DEFAULT 'pending', -- 'approved', 'pending'
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Pre-seed Master Admin ulludabang@gmail.com
INSERT INTO public.app_users (email, name, role, status)
VALUES ('ulludabang@gmail.com', 'Master Admin', 'admin', 'approved')
ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'approved';

-- 10. Create 'activity_logs' Table
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_name TEXT,
    user_avatar TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(email);

-- Enable RLS
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- App users RLS
DROP POLICY IF EXISTS "Allow select app_users" ON public.app_users;
CREATE POLICY "Allow select app_users" ON public.app_users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all app_users" ON public.app_users;
CREATE POLICY "Allow all app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);

-- Activity logs RLS
DROP POLICY IF EXISTS "Allow select activity_logs" ON public.activity_logs;
CREATE POLICY "Allow select activity_logs" ON public.activity_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert activity_logs" ON public.activity_logs;
CREATE POLICY "Allow insert activity_logs" ON public.activity_logs FOR INSERT WITH CHECK (true);

-- 11. Realtime Publication for instant multi-device live sync
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime FOR ALL TABLES;
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE public.children;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sabhas;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
