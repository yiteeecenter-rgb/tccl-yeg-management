-- Migration v6: track page count per attached file, for automatic TOC page numbers
ALTER TABLE monthly_report_items ADD COLUMN IF NOT EXISTS page_count INT DEFAULT 1;

SELECT 'Migration v6 complete!' AS status;
