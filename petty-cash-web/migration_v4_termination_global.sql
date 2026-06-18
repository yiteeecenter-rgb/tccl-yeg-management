-- Migration v4: Move install_company and witness fields to top-level termination_records
ALTER TABLE termination_records
  ADD COLUMN IF NOT EXISTS install_company  TEXT,
  ADD COLUMN IF NOT EXISTS witness1_company TEXT,
  ADD COLUMN IF NOT EXISTS witness1_name    TEXT,
  ADD COLUMN IF NOT EXISTS witness2_company TEXT,
  ADD COLUMN IF NOT EXISTS witness2_name    TEXT;
