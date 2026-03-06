-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: crm_insights()
-- Returns a single JSON row with the unified CRM breakdown.
-- Called by the manager dashboard to visualise the business value
-- of merging profiles + residents into customers.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.crm_insights()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      count(*)                                              AS total_customers,
      count(*) FILTER (WHERE auth_id IS NOT NULL)           AS app_users,
      count(*) FILTER (WHERE auth_id IS NULL)               AS walk_ins,
      count(*) FILTER (WHERE unit_number IS NOT NULL
                         AND unit_number != '')              AS mailbox_renters,
      count(*) FILTER (WHERE is_vip)                        AS vips,
      count(*) FILTER (WHERE loyalty_points > 0)            AS loyalty_active,
      coalesce(sum(loyalty_points), 0)                      AS total_loyalty_points,
      count(*) FILTER (WHERE total_orders > 0)              AS has_ordered,
      coalesce(avg(total_orders) FILTER
        (WHERE total_orders > 0), 0)                        AS avg_orders_per_active
    FROM public.customers
  ),
  -- Mailbox renters who also have at least one cafe order (the overlap)
  crossover AS (
    SELECT count(DISTINCT c.id) AS mailbox_cafe_crossover
    FROM public.customers c
    WHERE c.unit_number IS NOT NULL
      AND c.unit_number != ''
      AND c.total_orders > 0
  ),
  -- Recently active (ordered in last 30 days, production only)
  recent AS (
    SELECT count(DISTINCT o.user_id) AS active_last_30d
    FROM public.orders o
    WHERE o.created_at >= now() - interval '30 days'
      AND o.status IN ('completed', 'ready', 'preparing')
      AND o.data_integrity_level = 'production'
  ),
  -- New signups in last 7 days
  new_signups AS (
    SELECT count(*) AS new_last_7d
    FROM public.customers
    WHERE created_at >= now() - interval '7 days'
  ),
  -- Top 5 favorite drinks
  drinks AS (
    SELECT jsonb_agg(row_to_json(d)::jsonb) AS top_drinks
    FROM (
      SELECT favorite_drink AS drink, count(*) AS count
      FROM public.customers
      WHERE favorite_drink IS NOT NULL
        AND favorite_drink != ''
        AND favorite_drink != 'Black Coffee'
      GROUP BY favorite_drink
      ORDER BY count DESC
      LIMIT 5
    ) d
  )
  SELECT jsonb_build_object(
    'total_customers',        b.total_customers,
    'app_users',              b.app_users,
    'walk_ins',               b.walk_ins,
    'mailbox_renters',        b.mailbox_renters,
    'vips',                   b.vips,
    'loyalty_active',         b.loyalty_active,
    'total_loyalty_points',   b.total_loyalty_points,
    'has_ordered',            b.has_ordered,
    'avg_orders_per_active',  round(b.avg_orders_per_active::numeric, 1),
    'mailbox_cafe_crossover', x.mailbox_cafe_crossover,
    'active_last_30d',        r.active_last_30d,
    'new_last_7d',            n.new_last_7d,
    'top_drinks',             coalesce(d.top_drinks, '[]'::jsonb)
  )
  FROM base b, crossover x, recent r, new_signups n, drinks d;
$$;

-- Grant execute to service_role only (manager endpoints use service_role)
REVOKE ALL ON FUNCTION public.crm_insights() FROM public;
GRANT EXECUTE ON FUNCTION public.crm_insights() TO service_role;
