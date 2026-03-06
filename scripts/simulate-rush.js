#!/usr/bin/env node
/*
 * Simulate a high-volume "Morning Rush" against ai-order.
 * Sends randomized orders concurrently and reports success, rate limits, and timing.
 *
 * CLI flags:
 *   --orders <n>              Total orders to send (default: random 15-20)
 *   --burst <n>               Orders per burst wave with 1 s gap between waves (default: all-at-once)
 *   --include-only-valid-menu Only use items fetched from the live menu (skip fallback & core injection)
 */

require('dotenv').config();

/* ── CLI argument parsing ─────────────────────────────────────── */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { orders: 0, burst: 0, validMenuOnly: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--orders' && args[i + 1]) {
      opts.orders = Math.max(1, parseInt(args[i + 1], 10) || 0);
      i += 1;
    } else if (args[i] === '--burst' && args[i + 1]) {
      opts.burst = Math.max(1, parseInt(args[i + 1], 10) || 0);
      i += 1;
    } else if (args[i] === '--include-only-valid-menu') {
      opts.validMenuOnly = true;
    }
  }
  return opts;
}

const CLI = parseArgs();

const API_BASE_URL =
  process.env.API_URL || process.env.BREWHUB_API_URL || 'http://localhost:8888';
const API_KEY = process.env.BREWHUB_API_KEY;
const ORDER_COUNT = CLI.orders || randomInt(15, 20);

const ORDER_ENDPOINT = `${API_BASE_URL.replace(/\/$/, '')}/.netlify/functions/ai-order`;

async function getFetch() {
  if (typeof fetch === 'function') {
    return fetch;
  }

  const nodeFetch = await import('node-fetch');
  return nodeFetch.default;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uniqueItems(count, pool) {
  const copy = [...pool];
  const picked = [];
  const maxCount = Math.min(count, copy.length);
  for (let i = 0; i < maxCount; i += 1) {
    const idx = randomInt(0, copy.length - 1);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return picked;
}

function buildOrder(index, menuPool) {
  const lineCount = randomInt(1, 3);
  const itemNames = uniqueItems(lineCount, menuPool);

  return {
    customer_name: `RushSim-${Date.now()}-${index + 1}`,
    notes: 'Morning Rush load test (data_integrity_level isolated)',
    items: itemNames.map((name) => ({
      name,
      quantity: randomInt(1, 4),
    })),
  };
}

/** Inject up to 3 verified menu items into early orders for coverage. */
function ensureCoverage(orders, menuPool) {
  // Pick up to 3 items directly from the live menu pool
  const coverage = menuPool.slice(0, Math.min(3, menuPool.length));
  for (let i = 0; i < coverage.length && i < orders.length; i += 1) {
    orders[i].items.push({ name: coverage[i], quantity: randomInt(1, 3) });
  }
}

async function getLiveMenuNames(fetchFn) {
  const menuEndpoint = `${API_BASE_URL.replace(/\/$/, '')}/.netlify/functions/get-menu`;
  const response = await fetchFn(menuEndpoint, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`menu fetch failed (${response.status})`);
  }

  const payload = await response.json();
  const menuItems = Array.isArray(payload.menu_items) ? payload.menu_items : [];
  const names = menuItems
    .map((item) => item?.name)
    .filter((name) => typeof name === 'string' && name.trim().length > 0);

  if (names.length === 0) {
    throw new Error('menu payload has no names');
  }

  return names;
}

async function placeOrder(fetchFn, order, idx) {
  const response = await fetchFn(ORDER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(order),
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    payload = { error: 'non-json response' };
  }

  return {
    idx: idx + 1,
    status: response.status,
    ok: response.ok && payload && payload.success === true,
    payload,
  };
}

/** Fire orders in waves of `burstSize` with a 1 s gap between waves. */
async function fireInBursts(fetchFn, orders, burstSize) {
  const results = [];
  for (let i = 0; i < orders.length; i += burstSize) {
    const wave = orders.slice(i, i + burstSize);
    const waveResults = await Promise.allSettled(
      wave.map((order, j) => placeOrder(fetchFn, order, i + j))
    );
    results.push(...waveResults);
    if (i + burstSize < orders.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!API_KEY) {
    console.error('Missing BREWHUB_API_KEY in .env');
    process.exit(1);
  }

  const fetchFn = await getFetch();
  let menuPool;
  try {
    menuPool = await getLiveMenuNames(fetchFn);
  } catch (error) {
    if (CLI.validMenuOnly) {
      console.error(`Cannot use --include-only-valid-menu: ${error.message}`);
      process.exit(1);
    }
    console.warn(`Live menu unavailable (${error.message}) — using DB fallback names`);
    menuPool = null;
  }

  if (!menuPool) {
    // Static fallback — intentionally generic; will cause 400s if names drift
    menuPool = ['Drip Coffee', 'Latte', 'Espresso', 'Mocha', 'Cold Brew', 'Bagel', 'Cookie'];
  }

  const orders = Array.from({ length: ORDER_COUNT }, (_, idx) => buildOrder(idx, menuPool));
  if (!CLI.validMenuOnly) {
    ensureCoverage(orders, menuPool);
  }

  const burstLabel = CLI.burst ? `${CLI.burst}/wave` : 'all-at-once';
  console.log('Morning Rush simulator starting...');
  console.log(`Target: ${ORDER_ENDPOINT}`);
  console.log(`Concurrent orders: ${orders.length} (burst: ${burstLabel})`);
  console.log(`Menu pool (${menuPool.length}): ${menuPool.join(', ')}`);

  const startedAt = Date.now();
  let settled;
  if (CLI.burst) {
    settled = await fireInBursts(fetchFn, orders, CLI.burst);
  } else {
    settled = await Promise.allSettled(
      orders.map((order, idx) => placeOrder(fetchFn, order, idx))
    );
  }
  const elapsedMs = Date.now() - startedAt;

  /* ── Granular failure buckets ───────────────────────────────── */
  let succeeded = 0;
  let rateLimited = 0;
  let badRequest = 0;
  let serverError = 0;
  let networkReject = 0;

  for (const result of settled) {
    if (result.status === 'rejected') {
      networkReject += 1;
      continue;
    }
    if (result.value.ok) {
      succeeded += 1;
      continue;
    }
    const s = result.value.status;
    if (s === 429) rateLimited += 1;
    else if (s >= 400 && s < 500) badRequest += 1;
    else if (s >= 500) serverError += 1;
  }

  const totalFailed = rateLimited + badRequest + serverError + networkReject;

  console.log('');
  console.log('Rush batch results');
  console.log(`  Succeeded:        ${succeeded}`);
  console.log(`  Rate limited 429: ${rateLimited}`);
  console.log(`  Bad request 4xx:  ${badRequest}`);
  console.log(`  Server error 5xx: ${serverError}`);
  console.log(`  Network rejects:  ${networkReject}`);
  console.log(`  Failed total:     ${totalFailed}`);
  console.log(`  Batch time:       ${elapsedMs}ms`);

  const failures = settled
    .map((result, i) => {
      if (result.status === 'rejected') {
        return `Order #${i + 1}: NETWORK (${result.reason?.message || 'unknown error'})`;
      }
      if (result.value.ok) {
        return null;
      }
      return `Order #${result.value.idx}: HTTP ${result.value.status} (${result.value.payload?.error || 'no error payload'})`;
    })
    .filter(Boolean);

  if (failures.length > 0) {
    console.log('');
    console.log('Failure details');
    for (const line of failures) {
      console.log(`- ${line}`);
    }
  }
}

main().catch((error) => {
  console.error('Rush simulator crashed:', error);
  process.exit(1);
});
