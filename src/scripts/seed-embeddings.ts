/**
 * seed-embeddings.ts
 *
 * One-time script to backfill Cohere embed-english-v3.0 embeddings
 * for every merch_products row that doesn't have one yet.
 *
 * Usage:
 *   npx tsx src/scripts/seed-embeddings.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { embed } from 'ai';
import { createCohere } from '@ai-sdk/cohere';

/* ── env guards ───────────────────────────────────────────────── */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cohereKey = process.env.COHERE_API_KEY;

if (!supabaseUrl || !supabaseKey || !cohereKey) {
  console.error(
    'Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COHERE_API_KEY',
  );
  process.exit(1);
}

/* ── clients ──────────────────────────────────────────────────── */

const supabase = createClient(supabaseUrl, supabaseKey);
const cohere = createCohere({ apiKey: cohereKey });

/* ── main ─────────────────────────────────────────────────────── */

async function main() {
  // 1. Fetch rows that still need an embedding
  const { data: items, error: fetchError } = await supabase
    .from('merch_products')
    .select('id, name, category, description')
    .is('embedding', null);

  if (fetchError) {
    console.error('Failed to fetch merch_products:', fetchError.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log('All merch_products already have embeddings. Nothing to do.');
    return;
  }

  console.log(`Found ${items.length} item(s) without embeddings. Starting…\n`);

  let successCount = 0;
  let failCount = 0;

  for (const item of items) {
    const textToEmbed = `Category: ${item.category}. Product: ${item.name}. Description: ${item.description}`;

    try {
      const { embedding } = await embed({
        model: cohere.embedding('embed-english-v3.0'),
        value: textToEmbed,
      });

      const { error: updateError } = await supabase
        .from('merch_products')
        .update({ embedding })
        .eq('id', item.id);

      if (updateError) {
        console.error(`✗ [${item.name}] DB update failed: ${updateError.message}`);
        failCount++;
        continue;
      }

      successCount++;
      console.log(`✓ [${item.name}] embedded (${embedding.length}-d vector)`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ [${item.name}] Cohere embed failed: ${message}`);
      failCount++;
    }
  }

  console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
}

main();
