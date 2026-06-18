-- ========================================
-- Construction Management System - Database Setup
-- Run this in Supabase SQL Editor
-- ========================================

-- 1. Companies
CREATE TABLE IF NOT EXISTS companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO companies (name, short_name) VALUES
  ('TCCL', 'TCCL'),
  ('Yipintsoi Energy', 'YEG')
ON CONFLICT DO NOTHING;

-- 2. User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','staff','owner')),
  company_id UUID REFERENCES companies(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Petty cash documents
CREATE TABLE IF NOT EXISTS petty_cash (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_no TEXT NOT NULL,
  doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
  company_id UUID REFERENCES companies(id),
  created_by UUID REFERENCES profiles(id),
  purpose TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected')),
  total_amount NUMERIC(12,2) DEFAULT 0,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Expense items
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  petty_cash_id UUID REFERENCES petty_cash(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Trip records
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  petty_cash_id UUID REFERENCES petty_cash(id) ON DELETE CASCADE,
  trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
  origin TEXT,
  destination TEXT,
  distance NUMERIC(8,2) DEFAULT 0,
  rate NUMERIC(6,2) DEFAULT 5,
  amount NUMERIC(10,2) DEFAULT 0,
  purpose TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. General documents for approval
CREATE TABLE IF NOT EXISTS documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_no TEXT NOT NULL,
  title TEXT NOT NULL,
  doc_type TEXT DEFAULT 'general',
  company_id UUID REFERENCES companies(id),
  created_by UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  file_url TEXT,
  notes TEXT,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- Row Level Security (RLS)
-- ========================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read companies
CREATE POLICY "Anyone can view companies" ON companies FOR SELECT TO authenticated USING (true);

-- Profiles: users can view all profiles, edit only own
CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Petty cash: users can manage own records; admin/manager can manage all
CREATE POLICY "Staff can view own company records" ON petty_cash FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','owner'))
  );
CREATE POLICY "Staff can insert petty cash" ON petty_cash FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Staff can update own petty cash" ON petty_cash FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));

-- Expenses
CREATE POLICY "View expenses" ON expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage expenses" ON expenses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM petty_cash p WHERE p.id = petty_cash_id AND (p.created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')))));

-- Trips
CREATE POLICY "View trips" ON trips FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage trips" ON trips FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM petty_cash p WHERE p.id = petty_cash_id AND (p.created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')))));

-- Documents
CREATE POLICY "View documents" ON documents FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','owner'))
  );
CREATE POLICY "Create documents" ON documents FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Update documents" ON documents FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));

-- ========================================
-- Storage bucket for photos
-- ========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true)
ON CONFLICT DO NOTHING;

CREATE POLICY "Anyone can view receipts" ON storage.objects FOR SELECT USING (bucket_id = 'receipts');
CREATE POLICY "Auth users can upload receipts" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Auth users can update receipts" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'receipts');

-- Done!
SELECT 'Database setup complete!' AS status;
