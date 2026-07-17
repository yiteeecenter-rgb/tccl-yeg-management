-- Migration v5: Monthly Reports per station (รายงานประจำเดือนของงานแต่ละสถานี)
-- Structure: editable topic template (main items + sub-items) → per-report file
-- attached to each leaf sub-item → merged into a single combined PDF
-- (cover + table of contents + all attached files in order).

-- 1. Topic template (editable — admin/manager can add/rename/reorder/disable)
CREATE TABLE IF NOT EXISTS monthly_report_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,                 -- display label, e.g. '1', '1.1' — free text, re-numberable
  parent_id UUID REFERENCES monthly_report_topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. One row per station + month (report header)
CREATE TABLE IF NOT EXISTS monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  company_id UUID REFERENCES companies(id),
  report_month DATE NOT NULL,
  project_name TEXT,
  contract_no TEXT,
  merged_pdf_url TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, report_month)
);

-- 3. File attached to each leaf topic, for a given report
CREATE TABLE IF NOT EXISTS monthly_report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES monthly_reports(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES monthly_report_topics(id),
  file_url TEXT,
  file_name TEXT,
  file_type TEXT,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, topic_id)
);

-- ========================================
-- Row Level Security
-- ========================================
ALTER TABLE monthly_report_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_report_items   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View topics" ON monthly_report_topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage topics" ON monthly_report_topics FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));

CREATE POLICY "View monthly reports" ON monthly_reports FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','owner'))
  );
CREATE POLICY "Create monthly reports" ON monthly_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Update monthly reports" ON monthly_reports FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));
CREATE POLICY "Delete monthly reports" ON monthly_reports FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));

CREATE POLICY "View report items" ON monthly_report_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM monthly_reports r WHERE r.id = report_id AND (
      r.company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','owner'))
    )
  ));
CREATE POLICY "Manage report items" ON monthly_report_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM monthly_reports r WHERE r.id = report_id AND (
      r.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner'))
    )
  ));

-- ========================================
-- Storage bucket for attached files + merged PDFs
-- ========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('monthly-reports', 'monthly-reports', true)
ON CONFLICT DO NOTHING;

CREATE POLICY "Anyone can view monthly report files" ON storage.objects FOR SELECT USING (bucket_id = 'monthly-reports');
CREATE POLICY "Auth users can upload monthly report files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'monthly-reports');
CREATE POLICY "Auth users can update monthly report files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'monthly-reports');
CREATE POLICY "Auth users can delete monthly report files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'monthly-reports');

-- ========================================
-- Seed default topic template (EGAT-style monthly progress report TOC)
-- ========================================
DO $$
DECLARE
  m1 UUID; m2 UUID; m3 UUID; m4 UUID; m5 UUID; m6 UUID; m7 UUID; m8 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM monthly_report_topics) THEN
    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('1','Introduction',10) RETURNING id INTO m1;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('1.1',m1,'Project Description',11),
      ('1.2',m1,'Scope of Work',12),
      ('1.3',m1,'Contract Price Summary',13);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('2','Project Work Schedule & Work Progress',20) RETURNING id INTO m2;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('2.1',m2,'Schedule of Substation Construction',21),
      ('2.2',m2,'Summary of Work Progress',22);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('3','Drawing Status',30) RETURNING id INTO m3;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('3.1',m3,'Drawing Status of Architectural Design Section',31),
      ('3.2',m3,'Drawing Status of Structure & Civil Design Section',32),
      ('3.3',m3,'Drawing Status of Substation Design Section ( Primary Drawing )',33),
      ('3.4',m3,'Drawing Status of Outdoor & Indoor Lighting Design Section',34),
      ('3.5',m3,'Drawing Status of Control & Protection Design Section',35);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('4','Supply of Equipment',40) RETURNING id INTO m4;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('4.1',m4,'Equipment Status',41);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('5','Invoice',50) RETURNING id INTO m5;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('5.1',m5,'Payment Report',51);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('6','Project Resource',60) RETURNING id INTO m6;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('6.1',m6,'Manpower',61),
      ('6.2',m6,'Machinery & Tools',62),
      ('6.3',m6,'Weather Report',63);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('7','Problem, Obstruction and Solution',70) RETURNING id INTO m7;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('7.1',m7,'Problem, Obstruction and Solution',71),
      ('7.2',m7,'Critical Problem',72);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES ('8','Photograph Showing Progress of Work',80) RETURNING id INTO m8;
    INSERT INTO monthly_report_topics (code,parent_id,title,sort_order) VALUES
      ('8.1',m8,'Photograph',81);

    INSERT INTO monthly_report_topics (code,title,sort_order) VALUES
      ('9','Minute of Monthly Construction Meeting',90),
      ('10','Safety',100),
      ('11','Others',110);
  END IF;
END $$;

SELECT 'Migration v5 complete!' AS status;
