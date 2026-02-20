import { supabase } from '@/lib/supabase';
import ShopClient from './ShopClient';

// ─────────────────────────────────────────────────────────────────────────────
// ISR: Re-generate this page at most once every 60 seconds.
// 1,000 req/s → 1 Supabase query/min instead of 1,000/s.
// Eliminates the application-layer DoS vector on the connection pool.
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 60;

export const metadata = {
  title: 'Shop | BrewHub PHL',
  description:
    'Fresh roasted coffee + merch from Point Breeze, Philadelphia. Pickup in South Philly or ship nationwide.',
};

export default async function ShopPage() {
  let shopEnabled = true;
  let isMaintenanceMode = false;

  // ── Fetch shop settings (cached via ISR) ──────────────────────
  try {
    const { data: settingsData, error: settingsErr } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'shop_enabled')
      .single();

    if (settingsErr) throw settingsErr;
    shopEnabled = settingsData?.value !== false;
  } catch (err) {
    console.error('[Shop] Settings fetch failed:', err);
    isMaintenanceMode = true;
  }

  // ── Fetch products server-side (cached via ISR) ───────────────
  let products: {
    name: string;
    price_cents: number;
    description: string;
    image_url: string;
    checkout_url: string;
    sort_order: number;
    category?: string;
  }[] = [];

  if (shopEnabled && !isMaintenanceMode) {
    try {
      const { data, error } = await supabase
        .from('merch_products')
        .select('name, price_cents, description, image_url, checkout_url, sort_order, category')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      if (data) products = data;
    } catch (err) {
      console.error('[Shop] Products fetch failed:', err);
      isMaintenanceMode = true;
    }
  }

  // Pass pre-fetched data to the client shell (no client-side fetch needed)
  return <ShopClient products={products} shopEnabled={shopEnabled} isMaintenanceMode={isMaintenanceMode} />;
}
