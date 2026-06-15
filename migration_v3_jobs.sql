-- Migration v3: Jobs/Projects table

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  job_name TEXT NOT NULL,
  job_code TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read jobs"
  ON jobs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin/manager can manage jobs"
  ON jobs FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager')
  ));

-- ตัวอย่างข้อมูล
INSERT INTO jobs (company_id, job_name, job_code)
SELECT id, 'การไฟฟ้าส่วนภูมิภาค ขอนแก่น 1', 'P.254001' FROM companies WHERE short_name='YEG' LIMIT 1;

INSERT INTO jobs (company_id, job_name, job_code)
SELECT id, 'การไฟฟ้าส่วนภูมิภาค ขอนแก่น 2', 'P.254002' FROM companies WHERE short_name='YEG' LIMIT 1;

INSERT INTO jobs (company_id, job_name, job_code)
SELECT id, 'โครงการก่อสร้างสำนักงาน', 'P.254003' FROM companies WHERE short_name='TCCL' LIMIT 1;

SELECT 'Migration v3 complete!' AS status;
