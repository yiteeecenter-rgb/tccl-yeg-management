-- Migration v2: Add fields to match PDF format

-- เพิ่มฟิลด์ใน petty_cash
ALTER TABLE petty_cash
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS division TEXT,
  ADD COLUMN IF NOT EXISTS unit_code TEXT,
  ADD COLUMN IF NOT EXISTS is_so BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS so_number TEXT,
  ADD COLUMN IF NOT EXISTS is_project BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS project_number TEXT;

-- เพิ่มฟิลด์ใน trips
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS location_name TEXT,
  ADD COLUMN IF NOT EXISTS job_code TEXT,
  ADD COLUMN IF NOT EXISTS odometer_before NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS odometer_after NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS photo_before_url TEXT,
  ADD COLUMN IF NOT EXISTS photo_after_url TEXT,
  ADD COLUMN IF NOT EXISTS toll_amount NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_photo_url TEXT;

-- เพิ่มฟิลด์ใน expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS job_code TEXT;

SELECT 'Migration v2 complete!' AS status;
