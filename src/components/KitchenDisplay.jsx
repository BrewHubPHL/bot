import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Clock, CheckCircle, Coffee, AlertCircle, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// --- CONFIG ---
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL, 
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// --- STYLES (Tailwind classes for that "Dark Roast" vibe) ---
const STYLES = {
  container: "min-h-screen bg-slate-900 text-slate-100 p-6 font-sans",
  header: "flex justify-between items-center mb-8 border-b border-slate-700 pb-4",
  title: "text-3xl font-bold text-amber-500 tracking-tight flex items-center gap-3",
  grid: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6",
  card: "bg-slate-800 rounded-xl border-l-4 shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl",
  // Status Colors
  status: {
    paid: "border-emerald-500",      // New Order
    preparing: "border-amber-500",   // Being Made
    ready: "border-blue-500",        // Waiting for Pickup
  },
  badge: {
    paid: "bg-emerald-500/10 text-emerald-400",
    preparing: "bg-amber-500/10 text-amber-400",
    ready: "bg-blue-500/10 text-blue-400",
  }
};

export default function KitchenDisplay() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // 1. DATA FETCHING
  const fetchOrders = async () => {
    try {
      // Fetch Orders + their Child Items (coffee_orders)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          coffee_orders (
            id, drink_name, customizations, status
          )
        `)
        .in('status', ['paid', 'preparing', 'ready']) // Only active orders
        .order('created_at', { ascending: true }); // Oldest first (FIFO)

      if (error) throw error;
      setOrders(data || []);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err) {
      console.error("Error fetching tickets:", err);
    }
  };

  // 2. REALTIME SUBSCRIPTION
  useEffect(() => {
    fetchOrders();

    // Listen for ANY change to the 'orders' table
    const subscription = supabase
      .channel('kitchen-display')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        console.log("Change detected! Refreshing KDS...");
        fetchOrders();
      })
      .subscribe();

    // Auto-refresh every minute just in case (to update "5 mins ago" timers)
    const interval = setInterval(fetchOrders, 60000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // 3. ACTIONS
  const updateStatus = async (orderId, newStatus) => {
    // Optimistic Update (UI updates instantly)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));

    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId);

    if (error) {
      console.error("Failed to update status:", error);
      fetchOrders(); // Revert on error
    }
  };

  if (loading) return <div className="text-white text-center mt-20">Booting up the espresso machine...</div>;

  return (
    <div className={STYLES.container}>
      {/* HEADER */}
      <header className={STYLES.header}>
        <h1 className={STYLES.title}>
          <Coffee className="w-8 h-8" />
          BrewHub <span className="text-white">KDS</span>
        </h1>
        <div className="flex items-center gap-4 text-slate-400 text-sm">
          <span>Last synced: {lastUpdated.toLocaleTimeString()}</span>
          <button onClick={fetchOrders} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* KANBAN BOARD */}
      <div className={STYLES.grid}>
        {orders.length === 0 && (
          <div className="col-span-full text-center py-20 opacity-50">
            <h2 className="text-2xl">All caught up! 🎉</h2>
            <p>Time to wipe down the counters.</p>
          </div>
        )}

        {orders.map((order) => (
          <OrderCard 
            key={order.id} 
            order={order} 
            onUpdate={updateStatus} 
          />
        ))}
      </div>
    </div>
  );
}

// --- SUB-COMPONENT: INDIVIDUAL TICKET ---
function OrderCard({ order, onUpdate }) {
  const isStale = (new Date() - new Date(order.created_at)) > 1000 * 60 * 15; // 15 mins old
  
  // Decide visuals based on status
  const borderColor = STYLES.status[order.status] || "border-slate-600";
  const badgeColor = STYLES.badge[order.status] || "bg-slate-700 text-slate-300";

  return (
    <div className={`${STYLES.card} ${borderColor}`}>
      {/* CARD HEADER */}
      <div className="p-4 bg-slate-800/50 border-b border-slate-700 flex justify-between items-start">
        <div>
          <h3 className="font-bold text-lg text-white">
            {order.customer_name || "Guest"}
          </h3>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mt-1">
            <span>#{order.id.slice(0, 4)}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(order.created_at))} ago
            </span>
          </div>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${badgeColor}`}>
          {order.status}
        </span>
      </div>

      {/* DRINK LIST */}
      <div className="p-4 space-y-3">
        {order.coffee_orders && order.coffee_orders.map((item) => (
          <div key={item.id} className="flex items-start gap-3">
             <div className="mt-1">
               <div className="w-2 h-2 rounded-full bg-slate-500" />
             </div>
             <div>
               <p className="text-slate-200 font-medium text-lg leading-tight">
                 {item.drink_name}
               </p>
               {item.customizations && Object.keys(item.customizations).length > 0 && (
                 <p className="text-amber-400/80 text-sm mt-0.5">
                   {/* Render customizations nicely */}
                   {Array.isArray(item.customizations) 
                     ? item.customizations.join(', ') 
                     : JSON.stringify(item.customizations)}
                 </p>
               )}
             </div>
          </div>
        ))}
      </div>

      {/* FOOTER ACTIONS */}
      <div className="p-3 bg-slate-900/30 border-t border-slate-700 flex gap-2">
        {/* Logic: 
            Paid -> START ORDER -> Preparing
            Preparing -> ORDER UP -> Ready
            Ready -> CLEARED -> Completed (Archive)
        */}
        
        {order.status === 'paid' && (
          <button 
            onClick={() => onUpdate(order.id, 'preparing')}
            className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold transition-all flex justify-center items-center gap-2"
          >
            Start Order
          </button>
        )}

        {order.status === 'preparing' && (
          <button 
            onClick={() => onUpdate(order.id, 'ready')}
            className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-all shadow-lg shadow-amber-900/20"
          >
            Order Up! 🔔
          </button>
        )}

        {order.status === 'ready' && (
          <button 
            onClick={() => onUpdate(order.id, 'completed')}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold transition-all flex justify-center items-center gap-2"
          >
            <CheckCircle className="w-5 h-5" />
            Picked Up
          </button>
        )}
      </div>

      {/* LATE WARNING */}
      {isStale && order.status !== 'ready' && (
        <div className="bg-red-500/20 text-red-200 text-xs py-1 text-center font-bold flex justify-center gap-2">
          <AlertCircle className="w-4 h-4" /> 
          Running Late (>15m)
        </div>
      )}
    </div>
  );
}