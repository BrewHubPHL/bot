-- 1. Add the column to the profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pin text;

-- 2. Add a constraint to ensure it is exactly 6 digits (0-9)
-- This prevents accidental 5-digit entries or letters
ALTER TABLE public.profiles 
ADD CONSTRAINT pin_length_check CHECK (pin ~ '^[0-9]{6}$');

-- 3. Set the PIN for your Manager UUID
UPDATE public.profiles 
SET pin = '082297' 
WHERE id = '45723fbb-a2d3-4356-9154-eb5e506636c1';