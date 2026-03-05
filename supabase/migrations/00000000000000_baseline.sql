-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public._ip_salt (
  id boolean NOT NULL DEFAULT true CHECK (id),
  salt text NOT NULL,
  CONSTRAINT _ip_salt_pkey PRIMARY KEY (id)
);
CREATE TABLE public.api_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_name text NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  call_count integer NOT NULL DEFAULT 0,
  daily_limit integer NOT NULL DEFAULT 100,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT api_usage_pkey PRIMARY KEY (id)
);
CREATE TABLE public.app_secrets (
  key text NOT NULL,
  value text NOT NULL,
  CONSTRAINT app_secrets_pkey PRIMARY KEY (key)
);
CREATE TABLE public.coffee_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid,
  drink_name text NOT NULL,
  customizations jsonb,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  order_id uuid NOT NULL,
  guest_name text,
  customer_name text,
  price numeric DEFAULT 0.00,
  completed_at timestamp with time zone,
  completed_by uuid,
  CONSTRAINT coffee_orders_pkey PRIMARY KEY (id),
  CONSTRAINT coffee_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.profiles(id),
  CONSTRAINT fk_coffee_orders_order FOREIGN KEY (order_id) REFERENCES public.orders(id)
);
CREATE TABLE public.comp_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  staff_email text NOT NULL,
  staff_role text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  reason text NOT NULL DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT comp_audit_pkey PRIMARY KEY (id),
  CONSTRAINT comp_audit_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT comp_audit_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff_directory(id)
);
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  email text NOT NULL UNIQUE,
  full_name text,
  phone text,
  address_street text,
  address_city text DEFAULT 'Philadelphia'::text,
  address_zip text DEFAULT '19146'::text,
  created_at timestamp with time zone DEFAULT now(),
  name text,
  address text,
  sms_opt_in boolean DEFAULT false,
  loyalty_points integer NOT NULL DEFAULT 0,
  CONSTRAINT customers_pkey PRIMARY KEY (id)
);
CREATE TABLE public.deletion_tombstones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_key text NOT NULL,
  key_type text NOT NULL DEFAULT 'email'::text,
  deleted_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_by text,
  reason text DEFAULT 'GDPR Article 17 - Right to Erasure'::text,
  CONSTRAINT deletion_tombstones_pkey PRIMARY KEY (id)
);
CREATE TABLE public.expected_parcels (
  id integer NOT NULL DEFAULT nextval('expected_parcels_id_seq'::regclass),
  tracking_number text NOT NULL UNIQUE,
  carrier text,
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  unit_number text,
  status text DEFAULT 'pending'::text,
  registered_at timestamp with time zone DEFAULT now(),
  arrived_at timestamp with time zone,
  sms_consent boolean DEFAULT false,
  sms_consent_at timestamp with time zone,
  sms_consent_ip text,
  CONSTRAINT expected_parcels_pkey PRIMARY KEY (id)
);
CREATE TABLE public.expected_rents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  unit_type text NOT NULL UNIQUE,
  expected_monthly_rent numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT expected_rents_pkey PRIMARY KEY (id)
);
CREATE TABLE public.gdpr_secrets (
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gdpr_secrets_pkey PRIMARY KEY (key)
);
CREATE TABLE public.guest_order_denylist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_ip_hash text NOT NULL UNIQUE,
  reason text,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone,
  CONSTRAINT guest_order_denylist_pkey PRIMARY KEY (id)
);
CREATE TABLE public.inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_name text NOT NULL UNIQUE,
  current_stock integer DEFAULT 0,
  min_threshold integer DEFAULT 10,
  unit text DEFAULT 'units'::text,
  updated_at timestamp with time zone DEFAULT now(),
  barcode text UNIQUE,
  is_visible boolean DEFAULT true,
  category text DEFAULT 'general'::text,
  CONSTRAINT inventory_pkey PRIMARY KEY (id)
);
CREATE TABLE public.inventory_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  item_name text,
  delta integer NOT NULL,
  new_qty integer,
  source text NOT NULL DEFAULT 'manual'::text,
  triggered_by text,
  order_id uuid,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_audit_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.inventory_shrinkage_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  category text NOT NULL CHECK (category = ANY (ARRAY['breakage'::text, 'spoilage'::text, 'theft'::text, 'other'::text])),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost_cents integer NOT NULL CHECK (unit_cost_cents >= 0),
  total_loss_cents integer NOT NULL CHECK (total_loss_cents >= 0),
  reason text NOT NULL CHECK (char_length(reason) >= 2),
  staff_id uuid NOT NULL,
  staff_email text NOT NULL,
  old_stock integer,
  new_stock integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_shrinkage_log_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_shrinkage_log_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.merch_products(id)
);
CREATE TABLE public.job_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  availability text,
  scenario_answer text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resume_url text,
  CONSTRAINT job_applications_pkey PRIMARY KEY (id)
);
CREATE TABLE public.listings (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  address text NOT NULL,
  price numeric NOT NULL,
  beds numeric NOT NULL,
  baths numeric NOT NULL,
  sqft numeric NOT NULL,
  image_url text,
  status text DEFAULT 'Available'::text,
  CONSTRAINT listings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.local_mentions (
  id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  username text,
  caption text,
  image_url text,
  likes integer,
  posted_at timestamp with time zone,
  CONSTRAINT local_mentions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.manager_challenge_nonces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_email text NOT NULL,
  action_type text NOT NULL,
  nonce text NOT NULL UNIQUE,
  consumed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  CONSTRAINT manager_challenge_nonces_pkey PRIMARY KEY (id)
);
CREATE TABLE public.manager_override_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_type text NOT NULL CHECK (action_type = ANY (ARRAY['comp_order'::text, 'adjust_hours'::text, 'fix_clock'::text, 'void_order'::text, 'voucher_override'::text, 'inventory_adjust'::text, 'discount_override'::text, 'parcel_override'::text, 'schedule_edit'::text, 'pin_reset'::text, 'role_change'::text])),
  manager_email text NOT NULL,
  manager_staff_id uuid,
  target_entity text,
  target_id text,
  target_employee text,
  details jsonb DEFAULT '{}'::jsonb,
  device_fingerprint text,
  ip_address text,
  challenge_method text CHECK (challenge_method IS NULL OR (challenge_method = ANY (ARRAY['totp'::text, 'pin_reentry'::text, 'none_legacy'::text]))),
  witness_staff_id uuid,
  witness_email text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT manager_override_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.marketing_leads (
  id text NOT NULL,
  username text,
  likes integer,
  caption text,
  status text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_leads_pkey PRIMARY KEY (id)
);
CREATE TABLE public.marketing_posts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  day_of_week text,
  topic text,
  caption text,
  CONSTRAINT marketing_posts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.merch_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  description text,
  image_url text,
  checkout_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  category text NOT NULL DEFAULT 'menu'::text CHECK (category = ANY (ARRAY['menu'::text, 'merch'::text, 'shipping'::text])),
  archived_at timestamp with time zone,
  stock_quantity integer,
  min_threshold integer,
  CONSTRAINT merch_products_pkey PRIMARY KEY (id)
);
CREATE TABLE public.notification_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'dead_letter'::text])),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  locked_until timestamp with time zone,
  locked_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  last_error text,
  source_table text,
  source_id uuid,
  CONSTRAINT notification_queue_pkey PRIMARY KEY (id)
);
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'unpaid'::text, 'paid'::text, 'preparing'::text, 'ready'::text, 'completed'::text, 'refunded'::text, 'cancelled'::text])),
  total_amount_cents integer NOT NULL,
  square_order_id text,
  created_at timestamp with time zone DEFAULT now(),
  payment_id text UNIQUE,
  notes text,
  customer_name text,
  customer_email text,
  inventory_decremented boolean DEFAULT false,
  completed_at timestamp with time zone,
  paid_amount_cents integer DEFAULT 0,
  paid_at timestamp with time zone,
  type text DEFAULT 'cafe'::text,
  shipping_address text,
  items jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  cups_decremented integer DEFAULT 0,
  square_checkout_id text,
  payment_confirmed_via text,
  client_ip_hash text,
  is_guest_order boolean DEFAULT false,
  fulfillment_type text DEFAULT 'pickup'::text CHECK (fulfillment_type = ANY (ARRAY['pickup'::text, 'shipping'::text])),
  offline_id text,
  claimed_by uuid,
  claimed_at timestamp with time zone,
  last_idempotency_key text,
  subtotal_cents integer,
  tax_amount_cents integer DEFAULT 0,
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.outbound_parcels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text,
  unit_number text,
  carrier text NOT NULL DEFAULT 'FedEx'::text,
  tracking_number text,
  description text,
  quoted_price_cents integer,
  order_id uuid,
  status text NOT NULL DEFAULT 'received'::text CHECK (status = ANY (ARRAY['received'::text, 'label_created'::text, 'awaiting_pickup'::text, 'picked_up'::text, 'in_transit'::text, 'delivered'::text, 'cancelled'::text])),
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  label_created_at timestamp with time zone,
  picked_up_at timestamp with time zone,
  received_by uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT outbound_parcels_pkey PRIMARY KEY (id),
  CONSTRAINT outbound_parcels_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);
CREATE TABLE public.parcel_pickup_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL,
  tracking_number text NOT NULL,
  attempt_type text NOT NULL CHECK (attempt_type = ANY (ARRAY['code_success'::text, 'code_fail'::text, 'id_verified'::text, 'manager_override'::text, 'denied'::text, 'locked_out'::text])),
  staff_user text NOT NULL,
  collector_name text,
  collector_id_last4 text,
  override_reason text,
  value_tier text,
  ip_address text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT parcel_pickup_log_pkey PRIMARY KEY (id),
  CONSTRAINT parcel_pickup_log_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES public.parcels(id)
);
CREATE TABLE public.parcels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL UNIQUE,
  carrier text,
  recipient_name text,
  status text DEFAULT 'in_transit'::text,
  received_at timestamp with time zone,
  picked_up_at timestamp with time zone,
  recipient_phone text,
  unit_number text,
  match_type text,
  notified_at timestamp with time zone,
  recipient_email text,
  pickup_code_hash text,
  estimated_value_tier text DEFAULT 'standard'::text CHECK (estimated_value_tier = ANY (ARRAY['standard'::text, 'high_value'::text, 'premium'::text])),
  pickup_verified_via text CHECK (pickup_verified_via IS NULL OR (pickup_verified_via = ANY (ARRAY['code'::text, 'code_and_id'::text, 'manager_override'::text]))),
  pickup_staff_id text,
  pickup_collector_name text,
  pickup_id_last4 text,
  pickup_attempts integer DEFAULT 0,
  pickup_locked_until timestamp with time zone,
  CONSTRAINT parcels_pkey PRIMARY KEY (id)
);
CREATE TABLE public.pin_attempts (
  ip text NOT NULL,
  fail_count integer NOT NULL DEFAULT 0,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  locked_until timestamp with time zone,
  CONSTRAINT pin_attempts_pkey PRIMARY KEY (ip)
);
CREATE TABLE public.processed_webhooks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'square'::text,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb,
  CONSTRAINT processed_webhooks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.properties (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  unit_name text NOT NULL,
  monthly_rent numeric NOT NULL,
  security_deposit numeric NOT NULL,
  water_rule text,
  tenant_email text,
  CONSTRAINT properties_pkey PRIMARY KEY (id)
);
CREATE TABLE public.property_expenses (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  property_address text DEFAULT '1448 S 17th St'::text,
  vendor_name text,
  description text,
  amount numeric NOT NULL,
  category USER-DEFINED NOT NULL,
  status USER-DEFINED DEFAULT 'estimated'::payment_status,
  due_date date,
  paid_at timestamp with time zone,
  invoice_url text,
  is_nnn_reimbursable boolean DEFAULT false,
  tenant_name text DEFAULT 'Daycare'::text,
  CONSTRAINT property_expenses_pkey PRIMARY KEY (id)
);
CREATE TABLE public.receipt_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid,
  receipt_text text NOT NULL,
  printed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT receipt_queue_pkey PRIMARY KEY (id),
  CONSTRAINT receipt_queue_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);
CREATE TABLE public.refund_locks (
  payment_id text NOT NULL,
  locked_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid,
  CONSTRAINT refund_locks_pkey PRIMARY KEY (payment_id)
);
CREATE TABLE public.rent_roll (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  date date NOT NULL,
  unit text NOT NULL,
  rent numeric NOT NULL CHECK (rent >= 0::numeric),
  water numeric NOT NULL CHECK (water >= 0::numeric),
  total_due numeric NOT NULL CHECK (total_due >= 0::numeric),
  status USER-DEFINED NOT NULL DEFAULT 'Pending'::payment_status,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rent_roll_pkey PRIMARY KEY (id)
);
CREATE TABLE public.revoked_users (
  user_id uuid NOT NULL,
  revoked_at timestamp with time zone NOT NULL DEFAULT now(),
  reason text,
  CONSTRAINT revoked_users_pkey PRIMARY KEY (user_id)
);
CREATE TABLE public.scheduled_shifts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  role_id text,
  location_id text DEFAULT 'brewhub_main'::text,
  status USER-DEFINED DEFAULT 'scheduled'::shift_status,
  google_event_id text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT scheduled_shifts_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_shifts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item text NOT NULL,
  amount numeric NOT NULL,
  action text,
  lease_terms text,
  reference text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT settlements_pkey PRIMARY KEY (id)
);
CREATE TABLE public.shift_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text])),
  actor_id uuid,
  actor_name text,
  old_data jsonb,
  new_data jsonb,
  changed_cols ARRAY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT shift_audit_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.shop_settings (
  id text NOT NULL,
  access_token text,
  refresh_token text,
  merchant_id text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT shop_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.site_settings (
  key text NOT NULL UNIQUE,
  value boolean,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_pkey PRIMARY KEY (key)
);
CREATE TABLE public.sms_consent_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  event_type text NOT NULL CHECK (event_type = ANY (ARRAY['opt_in'::text, 'opt_out'::text, 'resubscribe'::text])),
  source text NOT NULL,
  source_detail text,
  ip_address text,
  user_agent text,
  staff_email text,
  twilio_sid text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sms_consent_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.sms_delivery_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  message_type text NOT NULL,
  twilio_sid text,
  status text DEFAULT 'sent'::text,
  blocked_reason text,
  source_function text,
  staff_email text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sms_delivery_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.sms_opt_out (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  opted_out boolean NOT NULL DEFAULT true,
  opted_out_at timestamp with time zone DEFAULT now(),
  opted_in_at timestamp with time zone,
  source text NOT NULL DEFAULT 'twilio_stop'::text CHECK (source = ANY (ARRAY['twilio_stop'::text, 'twilio_webhook'::text, 'admin_manual'::text, 'resident_portal'::text, 'fcc_complaint'::text, 'carrier_block'::text, 'twilio_start'::text, 'resident_resubscribe'::text])),
  carrier_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sms_opt_out_pkey PRIMARY KEY (id)
);
CREATE TABLE public.staff_directory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  email text NOT NULL,
  role text DEFAULT 'Barista'::text,
  hourly_rate numeric DEFAULT 15.00,
  is_working_legacy boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  token_version integer NOT NULL DEFAULT 1,
  version_updated_at timestamp with time zone NOT NULL DEFAULT now(),
  full_name text,
  pin text CHECK (pin IS NULL OR pin ~ '^\d{6}$'::text),
  pin_hash text,
  pin_changed_at timestamp with time zone DEFAULT now(),
  pin_rotation_days integer DEFAULT 30,
  totp_secret text,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT staff_directory_pkey PRIMARY KEY (id)
);
CREATE TABLE public.store_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_ip_address text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT store_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.system_errors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  error_type text NOT NULL,
  severity text NOT NULL DEFAULT 'critical'::text CHECK (severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text])),
  source_function text NOT NULL,
  order_id uuid,
  payment_id text,
  amount_cents integer,
  error_message text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamp with time zone,
  resolved_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT system_errors_pkey PRIMARY KEY (id)
);
CREATE TABLE public.system_sync_logs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  ts timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL,
  profile_id uuid,
  email text,
  detail text,
  sql_state text,
  severity text NOT NULL DEFAULT 'error'::text,
  CONSTRAINT system_sync_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.time_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id text,
  employee_email text,
  clock_in timestamp with time zone DEFAULT now(),
  clock_out timestamp with time zone,
  status text DEFAULT 'Pending'::text,
  action_type text,
  created_at timestamp with time zone DEFAULT now(),
  needs_manager_review boolean NOT NULL DEFAULT false,
  notes text,
  delta_minutes numeric,
  manager_id uuid,
  CONSTRAINT time_logs_pkey PRIMARY KEY (id),
  CONSTRAINT fk_time_logs_manager_id FOREIGN KEY (manager_id) REFERENCES public.staff_directory(id)
);
CREATE TABLE public.unit_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  unit text NOT NULL UNIQUE,
  tenant_type text,
  security_deposit numeric DEFAULT 0,
  payment_method text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT unit_profiles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.voucher_redemption_fails (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  attempted_at timestamp with time zone NOT NULL DEFAULT now(),
  code_prefix text,
  CONSTRAINT voucher_redemption_fails_pkey PRIMARY KEY (id)
);
CREATE TABLE public.vouchers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  code text NOT NULL UNIQUE,
  is_redeemed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  redeemed_at timestamp with time zone,
  applied_to_order_id uuid,
  qr_code_base64 text,
  status text DEFAULT 'active'::text,
  code_hash text,
  CONSTRAINT vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT vouchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT vouchers_applied_to_order_id_fkey FOREIGN KEY (applied_to_order_id) REFERENCES public.orders(id),
  CONSTRAINT fk_vouchers_order FOREIGN KEY (applied_to_order_id) REFERENCES public.orders(id)
);
CREATE TABLE public.waitlist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT waitlist_pkey PRIMARY KEY (id)
);
CREATE TABLE public.water_charges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  unit text NOT NULL,
  total_bill numeric DEFAULT 0,
  tenant_owes numeric DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT water_charges_pkey PRIMARY KEY (id)
);
CREATE TABLE public.webauthn_challenges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  challenge text NOT NULL,
  staff_id uuid,
  type text NOT NULL CHECK (type = ANY (ARRAY['register'::text, 'authenticate'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:05:00'::interval),
  CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id),
  CONSTRAINT webauthn_challenges_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff_directory(id)
);
CREATE TABLE public.webauthn_credentials (
  id text NOT NULL,
  staff_id uuid NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports ARRAY DEFAULT '{}'::text[],
  device_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone,
  CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT webauthn_credentials_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff_directory(id)
);
CREATE TABLE public.webhook_events (
  event_id text NOT NULL,
  source text DEFAULT 'supabase'::text,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb,
  CONSTRAINT webhook_events_pkey PRIMARY KEY (event_id)
);

