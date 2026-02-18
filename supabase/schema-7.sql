-- Automatically sync coffee_orders status with the main order status
CREATE OR REPLACE FUNCTION sync_coffee_order_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.coffee_orders
  SET status = NEW.status
  WHERE order_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_coffee_status ON public.orders;
CREATE TRIGGER trg_sync_coffee_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_coffee_order_status();