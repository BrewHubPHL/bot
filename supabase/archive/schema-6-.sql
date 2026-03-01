-- 1. Create or Replace the Function with robust logging and logic
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_item_count int;
BEGIN
  -- Logic: If moving to 'completed' and we haven't touched inventory yet
  IF (NEW.status = 'completed') AND (OLD.status IS DISTINCT FROM 'completed') 
     AND (COALESCE(NEW.inventory_decremented, false) = false) THEN
    
    -- Count items in the coffee_orders table for this specific order
    SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
    WHERE order_id = NEW.id;
    
    -- If there are drinks, decrement the stock
    IF v_item_count > 0 THEN
      -- We'll look for an item with 'Cup' in the name so it's less fragile
      UPDATE public.inventory
      SET current_stock = GREATEST(0, current_stock - v_item_count),
          updated_at = now()
      WHERE item_name ILIKE '%Cup%';
    END IF;
    
    -- Set the flag to TRUE on the record being saved
    NEW.inventory_decremented := true;
    
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Re-bind the trigger as a BEFORE trigger so it can modify the NEW record
DROP TRIGGER IF EXISTS trg_order_completion ON public.orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_completion();