-- Migration v7: give topics 9, 10, 11 a sub-item each (e.g. '9.1'), matching
-- the structure of sections 1-8, so they also get a section cover divider
-- page. Any file already attached directly to the main topic (9, 10, or 11)
-- is moved onto its new sub-topic so it isn't lost.
DO $$
DECLARE
  m RECORD;
  new_sub_id UUID;
BEGIN
  FOR m IN SELECT id, code, title, sort_order FROM monthly_report_topics WHERE code IN ('9','10','11') AND parent_id IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM monthly_report_topics WHERE parent_id = m.id) THEN
      INSERT INTO monthly_report_topics (code, parent_id, title, sort_order)
      VALUES (m.code || '.1', m.id, m.title, m.sort_order + 1)
      RETURNING id INTO new_sub_id;

      UPDATE monthly_report_items SET topic_id = new_sub_id WHERE topic_id = m.id;
    END IF;
  END LOOP;
END $$;

SELECT 'Migration v7 complete!' AS status;
