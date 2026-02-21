INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES (gen_random_uuid(), 'thomas@brewhubphl.com', crypt('password123', gen_salt('bf')), now());

-- Grab the ID it just generated to put in the staff directory
INSERT INTO public.staff_directory (email, name, full_name, role, is_working, hourly_rate)
VALUES ('thomas@brewhubphl.com', 'Thomas', 'Thomas (Local Admin)', 'admin', false, 25.00);