create table public.staff_directory (
  id uuid not null default gen_random_uuid(),
  email text not null,
  role text not null,
  full_name text null,
  created_at timestamp with time zone null default now(),
  token_version integer not null default 1,
  version_updated_at timestamp with time zone not null default now(),
  constraint staff_directory_pkey primary key (id),
  constraint staff_directory_email_key unique (email),
  constraint staff_directory_role_check check (
    (
      role = any (
        array['staff'::text, 'manager'::text, 'admin'::text]
      )
    )
  )
) TABLESPACE pg_default;

create trigger staff_role_change_trigger BEFORE
update on staff_directory for EACH row
execute FUNCTION staff_role_change_invalidator();
