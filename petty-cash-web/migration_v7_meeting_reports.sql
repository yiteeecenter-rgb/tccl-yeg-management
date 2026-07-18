-- Migration v7: Meeting Reports per station (รายงานการประชุม)
-- Structure: one row per meeting (header + attendees + agenda topics as JSON)
-- + a separate action-item tracker that carries open items forward across
-- meetings for the same job, until marked done.

-- 1. Meeting header
CREATE TABLE IF NOT EXISTS meeting_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  company_id UUID REFERENCES companies(id),
  meeting_no TEXT,               -- free text, e.g. '12' or '12/2569'
  meeting_date DATE NOT NULL,
  location TEXT,
  attendees TEXT,                -- free text, one per line
  topics JSONB NOT NULL DEFAULT '[]', -- [{title, notes}] agenda discussed this meeting
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Action items — tied to a job (not a single meeting) so open items
-- keep showing up in every later meeting until resolved.
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) NOT NULL,
  origin_meeting_id UUID REFERENCES meeting_reports(id) ON DELETE SET NULL,
  issue TEXT NOT NULL,
  responsible TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- Row Level Security
-- ========================================
ALTER TABLE meeting_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View meeting reports" ON meeting_reports FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','owner'))
  );
CREATE POLICY "Create meeting reports" ON meeting_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Update meeting reports" ON meeting_reports FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));
CREATE POLICY "Delete meeting reports" ON meeting_reports FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner')));

CREATE POLICY "View action items" ON meeting_action_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_id AND (
      j.company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','owner'))
    )
  ));
CREATE POLICY "Manage action items" ON meeting_action_items FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','manager','owner'))
  );

SELECT 'Migration v7 complete!' AS status;
