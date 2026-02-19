| table_name          | column_name           | data_type                | is_nullable | column_default                               |
| ------------------- | --------------------- | ------------------------ | ----------- | -------------------------------------------- |
| api_usage           | id                    | uuid                     | NO          | gen_random_uuid()                            |
| api_usage           | service_name          | text                     | NO          | null                                         |
| api_usage           | usage_date            | date                     | NO          | CURRENT_DATE                                 |
| api_usage           | call_count            | integer                  | NO          | 0                                            |
| api_usage           | daily_limit           | integer                  | NO          | 100                                          |
| api_usage           | created_at            | timestamp with time zone | YES         | now()                                        |
| brewhub_nnn_summary | property_address      | text                     | YES         | null                                         |
| brewhub_nnn_summary | total_taxes           | numeric                  | YES         | null                                         |
| brewhub_nnn_summary | total_insurance       | numeric                  | YES         | null                                         |
| brewhub_nnn_summary | total_cam             | numeric                  | YES         | null                                         |
| brewhub_nnn_summary | total_tenant_billback | numeric                  | YES         | null                                         |
| coffee_orders       | id                    | uuid                     | NO          | gen_random_uuid()                            |
| coffee_orders       | customer_id           | uuid                     | YES         | null                                         |
| coffee_orders       | drink_name            | text                     | NO          | null                                         |
| coffee_orders       | customizations        | jsonb                    | YES         | null                                         |
| coffee_orders       | status                | text                     | YES         | 'pending'::text                              |
| coffee_orders       | created_at            | timestamp with time zone | YES         | now()                                        |
| coffee_orders       | order_id              | uuid                     | YES         | null                                         |
| coffee_orders       | guest_name            | text                     | YES         | null                                         |
| coffee_orders       | customer_name         | text                     | YES         | null                                         |
| coffee_orders       | price                 | numeric                  | YES         | 0.00                                         |
| customers           | id                    | uuid                     | NO          | uuid_generate_v4()                           |
| customers           | email                 | text                     | NO          | null                                         |
| customers           | full_name             | text                     | YES         | null                                         |
| customers           | phone                 | text                     | YES         | null                                         |
| customers           | address_street        | text                     | YES         | null                                         |
| customers           | address_city          | text                     | YES         | 'Philadelphia'::text                         |
| customers           | address_zip           | text                     | YES         | '19146'::text                                |
| customers           | created_at            | timestamp with time zone | YES         | now()                                        |
| customers           | name                  | text                     | YES         | null                                         |
| customers           | address               | text                     | YES         | null                                         |
| customers           | sms_opt_in            | boolean                  | YES         | false                                        |
| customers           | loyalty_points        | integer                  | NO          | 0                                            |
| daily_sales_report  | total_orders          | bigint                   | YES         | null                                         |
| daily_sales_report  | gross_revenue         | bigint                   | YES         | null                                         |
| daily_sales_report  | completed_orders      | bigint                   | YES         | null                                         |
| deletion_tombstones | id                    | uuid                     | NO          | gen_random_uuid()                            |
| deletion_tombstones | table_name            | text                     | NO          | null                                         |
| deletion_tombstones | record_key            | text                     | NO          | null                                         |
| deletion_tombstones | key_type              | text                     | NO          | 'email'::text                                |
| deletion_tombstones | deleted_at            | timestamp with time zone | NO          | now()                                        |
| deletion_tombstones | deleted_by            | text                     | YES         | null                                         |
| deletion_tombstones | reason                | text                     | YES         | 'GDPR Article 17 - Right to Erasure'::text   |
| expected_parcels    | id                    | integer                  | NO          | nextval('expected_parcels_id_seq'::regclass) |
| expected_parcels    | tracking_number       | text                     | NO          | null                                         |
| expected_parcels    | carrier               | text                     | YES         | null                                         |
| expected_parcels    | customer_name         | text                     | NO          | null                                         |
| expected_parcels    | customer_phone        | text                     | YES         | null                                         |
| expected_parcels    | customer_email        | text                     | YES         | null                                         |
| expected_parcels    | unit_number           | text                     | YES         | null                                         |
| expected_parcels    | status                | text                     | YES         | 'pending'::text                              |
| expected_parcels    | registered_at         | timestamp with time zone | YES         | null                                         |
| expected_parcels    | arrived_at            | timestamp with time zone | YES         | null                                         |
| expected_rents      | id                    | uuid                     | NO          | gen_random_uuid()                            |
| expected_rents      | unit_type             | text                     | NO          | null                                         |
| expected_rents      | expected_monthly_rent | numeric                  | NO          | null                                         |
| expected_rents      | created_at            | timestamp with time zone | NO          | now()                                        |
| gdpr_secrets        | key                   | text                     | NO          | null                                         |
| gdpr_secrets        | value                 | text                     | NO          | null                                         |
| gdpr_secrets        | created_at            | timestamp with time zone | NO          | now()                                        |
| inventory           | id                    | uuid                     | NO          | gen_random_uuid()                            |
| inventory           | item_name             | text                     | NO          | null                                         |
| inventory           | current_stock         | integer                  | YES         | 0                                            |
| inventory           | min_threshold         | integer                  | YES         | 10                                           |
| inventory           | unit                  | text                     | YES         | 'units'::text                                |
| inventory           | updated_at            | timestamp with time zone | YES         | now()                                        |
| inventory           | barcode               | text                     | YES         | null                                         |
| inventory           | is_visible            | boolean                  | YES         | true                                         |
| listings            | id                    | bigint                   | NO          | null                                         |
| listings            | created_at            | timestamp with time zone | NO          | timezone('utc'::text, now())                 |
| listings            | address               | text                     | NO          | null                                         |
| listings            | price                 | numeric                  | NO          | null                                         |
| listings            | beds                  | numeric                  | NO          | null                                         |
| listings            | baths                 | numeric                  | NO          | null                                         |
| listings            | sqft                  | numeric                  | NO          | null                                         |
| listings            | image_url             | text                     | YES         | null                                         |
| listings            | status                | text                     | YES         | 'Available'::text                            |
| local_mentions      | id                    | text                     | NO          | null                                         |
| local_mentions      | created_at            | timestamp with time zone | YES         | now()                                        |
| local_mentions      | username              | text                     | YES         | null                                         |
| local_mentions      | caption               | text                     | YES         | null                                         |
| local_mentions      | image_url             | text                     | YES         | null                                         |
| local_mentions      | likes                 | integer                  | YES         | null                                         |
| local_mentions      | posted_at             | timestamp with time zone | YES         | null                                         |
| marketing_leads     | id                    | text                     | NO          | null                                         |
| marketing_leads     | username              | text                     | YES         | null                                         |
| marketing_leads     | likes                 | integer                  | YES         | null                                         |
| marketing_leads     | caption               | text                     | YES         | null                                         |
| marketing_leads     | status                | text                     | YES         | null                                         |
| marketing_leads     | created_at            | timestamp with time zone | YES         | now()                                        |
| marketing_posts     | id                    | bigint                   | NO          | null                                         |
| marketing_posts     | created_at            | timestamp with time zone | NO          | timezone('utc'::text, now())                 |
| marketing_posts     | day_of_week           | text                     | YES         | null                                         |
| marketing_posts     | topic                 | text                     | YES         | null                                         |
| marketing_posts     | caption               | text                     | YES         | null                                         |
| merch_products      | id                    | uuid                     | NO          | gen_random_uuid()                            |
| merch_products      | name                  | text                     | NO          | null                                         |
| merch_products      | price_cents           | integer                  | NO          | null                                         |
| merch_products      | description           | text                     | YES         | null                                         |
| merch_products      | image_url             | text                     | YES         | null                                         |
| merch_products      | checkout_url          | text                     | YES         | null                                         |
| merch_products      | is_active             | boolean                  | NO          | true                                         |
| merch_products      | sort_order            | integer                  | NO          | 0                                            |
| merch_products      | created_at            | timestamp with time zone | NO          | now()                                        |
| merch_products      | updated_at            | timestamp with time zone | NO          | now()                                        |
| notification_queue  | id                    | uuid                     | NO          | gen_random_uuid()                            |
| notification_queue  | task_type             | text                     | NO          | null                                         |
| notification_queue  | payload               | jsonb                    | NO          | null                                         |
| notification_queue  | status                | text                     | NO          | 'pending'::text                              |
| notification_queue  | attempt_count         | integer                  | NO          | 0                                            |
| notification_queue  | max_attempts          | integer                  | NO          | 3                                            |
| notification_queue  | next_attempt_at       | timestamp with time zone | NO          | now()                                        |
| notification_queue  | locked_until          | timestamp with time zone | YES         | null                                         |
| notification_queue  | locked_by             | text                     | YES         | null                                         |
| notification_queue  | created_at            | timestamp with time zone | NO          | now()                                        |
| notification_queue  | completed_at          | timestamp with time zone | YES         | null                                         |
| notification_queue  | last_error            | text                     | YES         | null                                         |
| notification_queue  | source_table          | text                     | YES         | null                                         |
| notification_queue  | source_id             | uuid                     | YES         | null                                         |
| orders              | id                    | uuid                     | NO          | gen_random_uuid()                            |
| orders              | user_id               | uuid                     | YES         | null                                         |
| orders              | status                | text                     | YES         | 'pending'::text                              |
| orders              | total_amount_cents    | integer                  | NO          | null                                         |
| orders              | square_order_id       | text                     | YES         | null                                         |
| orders              | created_at            | timestamp with time zone | YES         | now()                                        |
| orders              | payment_id            | text                     | YES         | null                                         |
| orders              | notes                 | text                     | YES         | null                                         |
| orders              | customer_name         | text                     | YES         | null                                         |
| orders              | customer_email        | text                     | YES         | null                                         |
| orders              | inventory_decremented | boolean                  | YES         | false                                        |
| orders              | completed_at          | timestamp with time zone | YES         | null                                         |
| orders              | paid_amount_cents     | integer                  | YES         | null                                         |
| parcels             | id                    | uuid                     | NO          | gen_random_uuid()                            |
| parcels             | tracking_number       | text                     | NO          | null                                         |
| parcels             | carrier               | text                     | YES         | null                                         |
| parcels             | recipient_name        | text                     | YES         | null                                         |
| parcels             | status                | text                     | YES         | 'in_transit'::text                           |
| parcels             | received_at           | timestamp with time zone | YES         | null                                         |
| parcels             | picked_up_at          | timestamp with time zone | YES         | null                                         |
| parcels             | recipient_phone       | text                     | YES         | null                                         |
| parcels             | unit_number           | text                     | YES         | null                                         |
| parcels             | match_type            | text                     | YES         | null                                         |
| parcels             | notified_at           | timestamp with time zone | YES         | null                                         |
| pin_attempts        | ip                    | text                     | NO          | null                                         |
| pin_attempts        | fail_count            | integer                  | NO          | 0                                            |
| pin_attempts        | window_start          | timestamp with time zone | NO          | now()                                        |
| pin_attempts        | locked_until          | timestamp with time zone | YES         | null                                         |
| processed_webhooks  | id                    | uuid                     | NO          | gen_random_uuid()                            |
| processed_webhooks  | event_key             | text                     | NO          | null                                         |
| processed_webhooks  | event_type            | text                     | NO          | null                                         |
| processed_webhooks  | source                | text                     | NO          | 'square'::text                               |
| processed_webhooks  | processed_at          | timestamp with time zone | NO          | now()                                        |
| processed_webhooks  | payload               | jsonb                    | YES         | null                                         |
| profiles            | id                    | uuid                     | NO          | null                                         |
| profiles            | full_name             | text                     | YES         | null                                         |
| profiles            | phone_number          | text                     | YES         | null                                         |
| profiles            | favorite_drink        | text                     | YES         | 'Black Coffee'::text                         |
| profiles            | loyalty_points        | integer                  | YES         | 0                                            |
| profiles            | barcode_id            | text                     | YES         | null                                         |
| profiles            | is_vip                | boolean                  | YES         | false                                        |
| profiles            | total_orders          | integer                  | YES         | 0                                            |
| properties          | id                    | uuid                     | NO          | uuid_generate_v4()                           |
| properties          | unit_name             | text                     | NO          | null                                         |
| properties          | monthly_rent          | numeric                  | NO          | null                                         |
| properties          | security_deposit      | numeric                  | NO          | null                                         |
| properties          | water_rule            | text                     | YES         | null                                         |
| properties          | tenant_email          | text                     | YES         | null                                         |
| property_expenses   | id                    | uuid                     | NO          | uuid_generate_v4()                           |
| property_expenses   | created_at            | timestamp with time zone | YES         | now()                                        |
| property_expenses   | property_address      | text                     | YES         | '1448 S 17th St'::text                       |
| property_expenses   | vendor_name           | text                     | YES         | null                                         |
| property_expenses   | description           | text                     | YES         | null                                         |
| property_expenses   | amount                | numeric                  | NO          | null                                         |
| property_expenses   | category              | USER-DEFINED             | NO          | null                                         |
| property_expenses   | status                | USER-DEFINED             | YES         | 'estimated'::payment_status                  |
| property_expenses   | due_date              | date                     | YES         | null                                         |
| property_expenses   | paid_at               | timestamp with time zone | YES         | null                                         |
| property_expenses   | invoice_url           | text                     | YES         | null                                         |
| property_expenses   | is_nnn_reimbursable   | boolean                  | YES         | false                                        |
| property_expenses   | tenant_name           | text                     | YES         | 'Daycare'::text                              |
| receipt_queue       | id                    | uuid                     | NO          | gen_random_uuid()                            |
| receipt_queue       | order_id              | uuid                     | YES         | null                                         |
| receipt_queue       | receipt_text          | text                     | NO          | null                                         |
| receipt_queue       | printed               | boolean                  | NO          | false                                        |
| receipt_queue       | created_at            | timestamp with time zone | NO          | now()                                        |
| refund_locks        | payment_id            | text                     | NO          | null                                         |
| refund_locks        | locked_at             | timestamp with time zone | NO          | now()                                        |
| refund_locks        | user_id               | uuid                     | YES         | null                                         |
| rent_roll           | id                    | uuid                     | NO          | gen_random_uuid()                            |
| rent_roll           | date                  | date                     | NO          | null                                         |
| rent_roll           | unit                  | text                     | NO          | null                                         |
| rent_roll           | rent                  | numeric                  | NO          | null                                         |
| rent_roll           | water                 | numeric                  | NO          | null                                         |
| rent_roll           | total_due             | numeric                  | NO          | null                                         |
| rent_roll           | status                | USER-DEFINED             | NO          | 'Pending'::payment_status                    |
| rent_roll           | notes                 | text                     | YES         | null                                         |
| rent_roll           | created_at            | timestamp with time zone | NO          | now()                                        |
| residents           | id                    | integer                  | NO          | nextval('residents_id_seq'::regclass)        |
| residents           | name                  | text                     | NO          | null                                         |
| residents           | unit_number           | text                     | YES         | null                                         |
| residents           | phone                 | text                     | YES         | null                                         |
| residents           | email                 | text                     | YES         | null                                         |
| revoked_users       | user_id               | uuid                     | NO          | null                                         |
| revoked_users       | revoked_at            | timestamp with time zone | NO          | now()                                        |
| revoked_users       | reason                | text                     | YES         | null                                         |
| settlements         | id                    | uuid                     | NO          | gen_random_uuid()                            |
| settlements         | item                  | text                     | NO          | null                                         |
| settlements         | amount                | numeric                  | NO          | null                                         |
| settlements         | action                | text                     | YES         | null                                         |
| settlements         | lease_terms           | text                     | YES         | null                                         |
| settlements         | reference             | text                     | YES         | null                                         |
| settlements         | created_at            | timestamp with time zone | NO          | now()                                        |
| site_settings       | key                   | text                     | NO          | null                                         |
| site_settings       | value                 | boolean                  | YES         | null                                         |
| site_settings       | updated_at            | timestamp with time zone | NO          | now()                                        |
| staff_directory     | id                    | uuid                     | NO          | gen_random_uuid()                            |
| staff_directory     | name                  | text                     | YES         | null                                         |
| staff_directory     | email                 | text                     | YES         | null                                         |
| staff_directory     | role                  | text                     | YES         | 'Barista'::text                              |
| staff_directory     | hourly_rate           | numeric                  | YES         | 15.00                                        |
| staff_directory     | is_working            | boolean                  | YES         | false                                        |
| staff_directory     | created_at            | timestamp with time zone | YES         | now()                                        |
| staff_directory     | token_version         | integer                  | NO          | 1                                            |
| staff_directory     | version_updated_at    | timestamp with time zone | NO          | now()                                        |
| staff_directory     | full_name             | text                     | YES         | null                                         |
| time_logs           | id                    | uuid                     | NO          | gen_random_uuid()                            |
| time_logs           | employee_id           | text                     | YES         | null                                         |
| time_logs           | employee_email        | text                     | YES         | null                                         |
| time_logs           | clock_in              | timestamp with time zone | YES         | now()                                        |
| time_logs           | clock_out             | timestamp with time zone | YES         | null                                         |
| time_logs           | status                | text                     | YES         | 'Pending'::text                              |
| time_logs           | action_type           | text                     | YES         | null                                         |
| time_logs           | created_at            | timestamp with time zone | YES         | now()                                        |
| unit_profiles       | id                    | uuid                     | NO          | gen_random_uuid()                            |
| unit_profiles       | unit                  | text                     | NO          | null                                         |
| unit_profiles       | tenant_type           | text                     | YES         | null                                         |
| unit_profiles       | security_deposit      | numeric                  | YES         | 0                                            |
| unit_profiles       | payment_method        | text                     | YES         | null                                         |
| unit_profiles       | created_at            | timestamp with time zone | NO          | now()                                        |
| vouchers            | id                    | uuid                     | NO          | gen_random_uuid()                            |
| vouchers            | user_id               | uuid                     | YES         | null                                         |
| vouchers            | code                  | text                     | NO          | null                                         |
| vouchers            | is_redeemed           | boolean                  | YES         | false                                        |
| vouchers            | created_at            | timestamp with time zone | YES         | now()                                        |
| vouchers            | redeemed_at           | timestamp with time zone | YES         | null                                         |
| vouchers            | applied_to_order_id   | uuid                     | YES         | null                                         |
| waitlist            | id                    | uuid                     | NO          | gen_random_uuid()                            |
| waitlist            | email                 | text                     | NO          | null                                         |
| waitlist            | created_at            | timestamp with time zone | YES         | now()                                        |
| water_charges       | id                    | uuid                     | NO          | gen_random_uuid()                            |
| water_charges       | unit                  | text                     | NO          | null                                         |
| water_charges       | total_bill            | numeric                  | YES         | 0                                            |
| water_charges       | tenant_owes           | numeric                  | YES         | 0                                            |
| water_charges       | notes                 | text                     | YES         | null                                         |
| water_charges       | created_at            | timestamp with time zone | NO          | now()                                        |
| webhook_events      | event_id              | text                     | NO          | null                                         |
| webhook_events      | source                | text                     | YES         | 'supabase'::text                             |
| webhook_events      | received_at           | timestamp with time zone | NO          | now()                                        |
| webhook_events      | payload               | jsonb                    | YES         | null                                         |