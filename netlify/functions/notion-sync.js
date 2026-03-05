const { createClient } = require('@supabase/supabase-js');
const { json, sanitizedError, verifyServiceSecret } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { publicBucket } = require('./_token-bucket');
const { hashIP, redactIP } = require('./_ip-hash');
const { logSystemError } = require('./_system-errors');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getClientIP(event) {
  return event.headers?.['x-nf-client-connection-ip']
    || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

function safeJsonParse(raw) {
  try {
    return { value: JSON.parse(raw || '{}'), error: null };
  } catch {
    return { value: null, error: 'Invalid JSON body' };
  }
}

function truncate(value, maxLen) {
  return String(value || '').slice(0, maxLen);
}

function normalizedTableName(raw) {
  const table = sanitizeInput(raw).trim().toLowerCase().slice(0, 64);
  return table;
}

function resolveTargetDatabase(sourceTable, canonicalRecord) {
  if (sourceTable === 'orders' && canonicalRecord.status === 'completed') {
    const totalDollars = typeof canonicalRecord.total_amount_cents === 'number'
      ? canonicalRecord.total_amount_cents / 100
      : 0;

    return {
      key: 'sales_ledger',
      databaseId: process.env.NOTION_SALES_DB_ID,
      title: `Order ${canonicalRecord.id}`,
      properties: {
        Name: {
          title: [{ text: { content: truncate(`Order ${canonicalRecord.id}`, 200) } }],
        },
        Status: {
          status: { name: canonicalRecord.status === 'completed' ? 'Done' : canonicalRecord.status === 'in_progress' ? 'In progress' : 'Not started' },
        },
        Total: {
          number: totalDollars,
        },
      },
      summary: {
        status: canonicalRecord.status,
        total_amount_cents: canonicalRecord.total_amount_cents,
        payment_id: canonicalRecord.payment_id || null,
        completed_at: canonicalRecord.completed_at || null,
        customer_email: canonicalRecord.customer_email || null,
      },
    };
  }

  if (sourceTable === 'manager_override_log') {
    return {
      key: 'audit_trail',
      databaseId: process.env.NOTION_AUDIT_DB_ID,
      title: `Override ${canonicalRecord.action_type}`,
      properties: {
        Name: {
          title: [{ text: { content: truncate(`Override ${canonicalRecord.action_type}`, 200) } }],
        },
        'Manager': {
          rich_text: [{ text: { content: truncate(canonicalRecord.manager_email || '', 200) } }],
        },
        'Action': {
          select: { name: truncate(canonicalRecord.action_type || 'unknown', 100) },
        },
        'Target Entity': {
          rich_text: [{ text: { content: truncate(canonicalRecord.target_entity || '', 200) } }],
        },
        'Target ID': {
          rich_text: [{ text: { content: truncate(canonicalRecord.target_id || '', 200) } }],
        },
        'Details': {
          rich_text: [{ text: { content: truncate(
            typeof canonicalRecord.details === 'object'
              ? JSON.stringify(canonicalRecord.details)
              : String(canonicalRecord.details || ''),
            2000
          ) } }],
        },
      },
      summary: {
        action_type: canonicalRecord.action_type,
        manager_email: canonicalRecord.manager_email,
        target_entity: canonicalRecord.target_entity || null,
        target_id: canonicalRecord.target_id || null,
        created_at: canonicalRecord.created_at || null,
      },
    };
  }

  if (sourceTable === 'customers' && process.env.NOTION_CUSTOMERS_DATABASE_ID) {
    return {
      key: 'customers',
      databaseId: process.env.NOTION_CUSTOMERS_DATABASE_ID,
      title: `Customer ${canonicalRecord.full_name || canonicalRecord.id}`,
      properties: {
        Name: {
          title: [{ text: { content: truncate(`Customer ${canonicalRecord.full_name || canonicalRecord.id}`, 200) } }],
        },
      },
      summary: {
        full_name: canonicalRecord.full_name,
        email: canonicalRecord.email,
        loyalty_points: canonicalRecord.loyalty_points,
        is_vip: canonicalRecord.is_vip,
      },
    };
  }

  return null;
}

async function fetchCanonicalRecord(sourceTable, recordId) {
  if (sourceTable === 'orders') {
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, total_amount_cents, payment_id, completed_at, created_at, customer_email, customer_name')
      .eq('id', recordId)
      .single();
    if (error) throw error;
    return data;
  }

  if (sourceTable === 'manager_override_log') {
    const { data, error } = await supabase
      .from('manager_override_log')
      .select('id, action_type, manager_email, target_entity, target_id, target_employee, details, challenge_method, created_at')
      .eq('id', recordId)
      .single();
    if (error) throw error;
    return data;
  }

  if (sourceTable === 'customers') {
    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone, loyalty_points, is_vip, total_orders, created_at')
      .eq('id', recordId)
      .single();
    if (error) throw error;
    return data;
  }

  throw new Error(`Unsupported source_table: ${sourceTable}`);
}

async function notionRequest(path, options = {}) {
  const token = process.env.NOTION_API_KEY || process.env.NOTION_INTERNAL_TOKEN;
  if (!token) throw new Error('NOTION_API_KEY / NOTION_INTERNAL_TOKEN is not configured');

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const msg = payload?.message || `Notion API failed (${response.status})`;
    throw new Error(msg);
  }

  return payload;
}

async function createNotionPage(databaseId, properties, summaryPayload) {
  const prettySummary = truncate(JSON.stringify(summaryPayload), 1800);

  return notionRequest('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: prettySummary },
              },
            ],
          },
        },
      ],
    }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // DEBUG: log what the trigger is sending (remove after testing)
  const incomingSecret = event.headers?.['x-brewhub-secret'] || '';
  const envSecret = process.env.INTERNAL_SYNC_SECRET || '';
  console.log('[notion-sync] incoming first4/last4:', incomingSecret.slice(0, 4), '...', incomingSecret.slice(-4));
  console.log('[notion-sync] env      first4/last4:', envSecret.slice(0, 4), '...', envSecret.slice(-4));
  console.log('[notion-sync] match?', incomingSecret === envSecret);

  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) {
    console.warn('[notion-sync] verifyServiceSecret REJECTED — 401');
    return serviceAuth.response;
  }

  const clientIP = getClientIP(event);
  const bucketKey = `notion-sync:${hashIP(clientIP)}`;
  const rate = publicBucket.consume(bucketKey);
  if (!rate.allowed) {
    return json(429, { error: 'Too many requests' });
  }

  const { value: body, error: parseError } = safeJsonParse(event.body);
  if (parseError) return json(400, { error: parseError });

  const sourceTable = normalizedTableName(body?.source_table);
  const incomingRecordId = sanitizeInput(body?.record?.id || body?.record_id || '').slice(0, 64);

  if (!sourceTable || !incomingRecordId) {
    return json(400, { error: 'source_table and record.id are required' });
  }

  const syncKey = sanitizeInput(
    body?.sync_key || `${sourceTable}:${incomingRecordId}`
  ).slice(0, 190);

  try {
    const canonicalRecord = await fetchCanonicalRecord(sourceTable, incomingRecordId);
    const target = resolveTargetDatabase(sourceTable, canonicalRecord);

    if (!target) {
      return json(202, {
        ok: true,
        skipped: true,
        reason: 'No Notion mapping configured for this record',
      });
    }

    if (!target.databaseId) {
      return json(500, {
        error: `Missing Notion database env for mapping: ${target.key}`,
      });
    }

    const gatePayload = {
      source_table: sourceTable,
      record_id: canonicalRecord.id,
      target: target.key,
    };

    const { error: gateError } = await supabase
      .from('processed_notion_syncs')
      .insert({
        sync_key: syncKey,
        source_table: sourceTable,
        source_record_id: canonicalRecord.id,
        notion_database: target.key,
        payload: gatePayload,
      });

    if (gateError) {
      if (gateError.code === '23505') {
        return json(200, {
          ok: true,
          duplicate: true,
          sync_key: syncKey,
        });
      }
      throw gateError;
    }

    const notionPage = await createNotionPage(target.databaseId, target.properties, {
      source_table: sourceTable,
      record: target.summary,
      synced_at: new Date().toISOString(),
    });

    return json(200, {
      ok: true,
      source_table: sourceTable,
      record_id: canonicalRecord.id,
      notion_page_id: notionPage?.id || null,
    });
  } catch (error) {
    await logSystemError(supabase, {
      error_type: 'notion_sync_failed',
      severity: 'warning',
      source_function: 'notion-sync',
      error_message: truncate(error?.message || 'Unknown sync error', 500),
      context: {
        source_table: sourceTable,
        record_id: incomingRecordId,
        client_ip: redactIP(clientIP),
      },
    });
    return sanitizedError(error, 'notion-sync');
  }
};
