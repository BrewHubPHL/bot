-- 1. Create the Shift Status Enum (Skip if you already have this)
DO $$ BEGIN
    CREATE TYPE public.shift_status AS ENUM ('scheduled', 'completed', 'no_show', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Enable extension required for the overlap exclusion constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 3. Create the Base Table (with updated_at included from the start)
CREATE TABLE public.scheduled_shifts (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  role_id text null,
  location_id text null default 'brewhub_main'::text,
  status public.shift_status null default 'scheduled'::shift_status,
  google_event_id text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),

  constraint scheduled_shifts_pkey primary key (id),
  constraint scheduled_shifts_user_id_fkey foreign KEY (user_id) references auth.users (id),
  constraint logical_times check ((end_time > start_time)),
  
  -- Claude's Audit Fix: Physically prevent overlapping shifts for the same user
  constraint no_overlapping_shifts EXCLUDE USING gist (
      user_id WITH =,
      tstzrange(start_time, end_time) WITH &&
  )
) TABLESPACE pg_default;

-- 4. Create the Trigger Function for updated_at
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach Trigger to the Table
CREATE TRIGGER update_scheduled_shifts_modtime
BEFORE UPDATE ON public.scheduled_shifts
FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();