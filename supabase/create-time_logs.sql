create table public.time_logs (
  id uuid not null default gen_random_uuid(),
  employee_id text null,
  employee_email text null,
  clock_in timestamp with time zone null default now(),
  clock_out timestamp with time zone null,
  status text null default 'Pending'::text,
  action_type text null,
  created_at timestamp with time zone null default now(),
  constraint time_logs_pkey primary key (id)
) TABLESPACE pg_default;
