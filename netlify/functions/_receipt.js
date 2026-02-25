/**
 * _receipt.js — Shared receipt generation helper
 *
 * Generates a 32-column fixed-width plain-text receipt string
 * formatted for thermal printers, and queues it in receipt_queue.
 *
 * Usage:
 *   const { generateReceiptString, queueReceipt } = require('./_receipt');
 *   const text = generateReceiptString(order, items);
 *   await queueReceipt(supabase, order.id, text);
 */

const W = 32; // Thermal printer column width

/**
 * Center a string within a fixed width.
 * @param {string} str
 * @param {number} width
 * @returns {string}
 */
function center(str, width = W) {
  if (str.length >= width) return str.substring(0, width);
  const pad = Math.floor((width - str.length) / 2);
  return ' '.repeat(pad) + str;
}

/**
 * Format cents to a dollar string like "$13.25"
 * @param {number} cents
 * @returns {string}
 */
function formatMoney(cents) {
  const dollars = (Math.abs(cents) / 100).toFixed(2);
  return `$${dollars}`;
}

/**
 * Build a short order tag from a UUID (e.g., "BRW-7K2L")
 * @param {string} uuid
 * @returns {string}
 */
function orderTag(uuid) {
  if (!uuid) return 'BRW-0000';
  const slug = uuid.replace(/-/g, '').substring(0, 4).toUpperCase();
  return `BRW-${slug}`;
}

/**
 * Format a date to MM/DD/YYYY hh:mm AM/PM (Eastern Time)
 * @param {string|Date} dateInput
 * @returns {string}
 */
function formatDate(dateInput) {
  try {
    const d = new Date(dateInput);
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return 'N/A';
  }
}

/**
 * Map a payment_id value to a human-readable label.
 * @param {string|null} paymentId
 * @returns {string}
 */
function paymentLabel(paymentId) {
  if (!paymentId) return 'Unpaid';
  const lower = paymentId.toLowerCase();
  if (lower === 'cash') return 'Cash';
  if (lower === 'comp') return 'Comp';
  if (lower === 'other') return 'Other';
  // Anything else (e.g., a Square payment ID) is a card payment
  return 'Square';
}

/**
 * Generate a plain-text receipt string formatted for a 32-column thermal printer.
 *
 * Layout per the BrewHub spec (strict 32-char width):
 * ================================
 *        BREWHUB PHL
 *   1801 S 20th St, Philly
 * ================================
 * Order #: BRW-7K2L
 * Date:    02/18/2026 11:42 AM
 * --------------------------------
 * Oat Latte          x1     $5.50
 * Iced Americano     x1     $4.00
 * Blueberry Muffin   x1     $3.75
 * --------------------------------
 * TOTAL                    $13.25
 * Paid: Square
 * --------------------------------
 *   Thank you, neighbor!
 *   Made the Philly Way.
 *
 *      ~ BrewHub PHL ~
 * ================================
 *
 * @param {object} order - Supabase order row (id, total_amount_cents, payment_id, created_at, customer_name, etc.)
 * @param {Array<{drink_name: string, price: number}>} items - coffee_orders rows for this order
 * @returns {string} The formatted receipt text
 */
function generateReceiptString(order, items) {
  const divider = '='.repeat(W);
  const thinDiv = '-'.repeat(W);
  const lines = [];

  // --- Header ---
  lines.push(divider);
  lines.push(center('BREWHUB PHL'));
  lines.push(center('Philly 19146'));
  lines.push(divider);

  // --- Order Info ---
  const tag = orderTag(order.id);
  lines.push(`Order #: ${tag}`);
  lines.push(`Date:    ${formatDate(order.created_at)}`);
  if (order.customer_name) {
    const safeName = String(order.customer_name).substring(0, 20);
    lines.push(`Name:    ${safeName}`);
  }
  lines.push(thinDiv);

  // --- Line Items (grouped by drink_name with quantity) ---
  const safeItems = Array.isArray(items) ? items : [];
  // Group identical items: { "Oat Latte": { qty: 2, unitPrice: 5.50 } }
  const grouped = new Map();
  for (const item of safeItems) {
    const name = String(item.drink_name || 'Item');
    const price = Number(item.price) || 0;
    if (grouped.has(name)) {
      const entry = grouped.get(name);
      entry.qty += 1;
    } else {
      grouped.set(name, { qty: 1, unitPrice: price });
    }
  }

  // MAX_NAME = 18 chars (truncate longer names)
  // Layout: {name.padEnd(18)} x{qty}{price.padStart(remaining)}
  // Total = 18 + 2 (space + x) + qty_digits + price_padded = 32
  const MAX_NAME = 18;
  for (const [name, { qty, unitPrice }] of grouped) {
    const truncName = name.length > MAX_NAME ? name.substring(0, MAX_NAME) : name;
    const qtyStr = `x${qty}`;
    // unitPrice is already in dollars (e.g. 5.50) — convert line total to cents for formatMoney
    const priceStr = formatMoney(Math.round(unitPrice * qty * 100));
    // Fill remaining space between name, qty, and price
    const fixedLeft = truncName.padEnd(MAX_NAME) + ' ' + qtyStr;
    const gap = W - fixedLeft.length - priceStr.length;
    const line = fixedLeft + ' '.repeat(Math.max(1, gap)) + priceStr;
    lines.push(line);
  }
  lines.push(thinDiv);

  // --- Total ---
  const totalStr = formatMoney(order.total_amount_cents || 0);
  const totalLabel = 'TOTAL';
  const totalGap = W - totalLabel.length - totalStr.length;
  lines.push(`${totalLabel}${' '.repeat(Math.max(1, totalGap))}${totalStr}`);

  // --- Payment ---
  lines.push(`Paid: ${paymentLabel(order.payment_id)}`);
  lines.push(thinDiv);

  // --- Footer ---
  lines.push(center('Thank you, neighbor!'));
  lines.push(center('Made the Philly Way.'));
  lines.push('');
  lines.push(center('~ BrewHub PHL ~'));
  lines.push(divider);

  return lines.join('\n');
}

/**
 * Insert a receipt into the print queue.
 *
 * @param {object} supabase - Supabase client (service role)
 * @param {string} orderId  - UUID of the order
 * @param {string} receiptText - The formatted receipt string
 * @returns {Promise<{error: object|null}>}
 */
async function queueReceipt(supabase, orderId, receiptText) {
  const { error } = await supabase
    .from('receipt_queue')
    .insert({ order_id: orderId, receipt_text: receiptText });

  if (error) {
    console.error('[RECEIPT] Failed to queue receipt:', error.message);
  } else {
    console.log(`[RECEIPT] Queued receipt for order ${orderId}`);
  }
  return { error };
}

module.exports = { generateReceiptString, queueReceipt };
