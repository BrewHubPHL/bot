'use strict';

/**
 * get-schema-health.js — Database schema auditor for agreement_signatures.
 *
 * GET /.netlify/functions/get-schema-health
 *
 * Queries information_schema.tables and information_schema.columns via
 * Supabase RPCs to verify that the `agreement_signatures` table exists
 * and contains every required column with the expected data types.
 *
 * Returns a structured health report so Managers know whether a migration
 * is needed.
 *
 * Auth: Manager PIN session required.
 */

const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { hashIP, redactIP } = require('./_ip-hash');

// ── Expected schema definitions ──────────────────────────────
// Each entry: column_name → expected data_type (Postgres type).
// We check every table listed in TABLES_TO_CHECK.

const TABLES_TO_CHECK = {
  agreement_signatures: {
    id:           'uuid',
    staff_id:     'uuid',
    version_tag:  'text',
    ip_address:   'text',
    user_agent:   'text',
    sha256_hash:  'text',
    signed_at:    'timestamp with time zone',
    created_at:   'timestamp with time zone',
  },
  maintenance_logs: {
    id:            'uuid',
    equipment_id:  'uuid',
    performed_at:  'date',
    cost:          'integer',     // integer (cents) — aligns with M-3 migration
    notes:         'text',
    performed_by:  'uuid',
    created_at:    'timestamp with time zone',
  },
};

// Backward-compat aliases (used by the per-table probe path below)
const EXPECTED_COLUMNS = TABLES_TO_CHECK.agreement_signatures;
const TABLE_NAME = 'agreement_signatures';
const SCHEMA_NAME = 'public';

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  // ── Preflight ──────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (MISSING_ENV) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // ── Rate limiting ──────────────────────────────────────────
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  try {
    const rlKey = `schema-health:${hashIP(clientIp)}`;
    const take = staffBucket.consume(rlKey);
    if (!take.allowed) {
      console.warn(`[SCHEMA-HEALTH] Rate limit hit from IP: ${redactIP(clientIp)}`);
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests. Please wait.', retryAfterMs: take.retryAfterMs }),
      };
    }
  } catch (rlErr) {
    console.error('[SCHEMA-HEALTH] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
  }

  // ── Authentication — require Manager role ──────────────────
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Check whether the table exists
    // ═══════════════════════════════════════════════════════════
    const { data: tableRows, error: tableErr } = await supabase
      .from('information_schema.tables' /* PostgREST does not expose this */)
      .select('table_name')
      .eq('table_schema', SCHEMA_NAME)
      .eq('table_name', TABLE_NAME);

    // information_schema is not exposed via PostgREST by default,
    // so we fall back to a raw SQL query via rpc if the above fails.
    let tableExists = false;
    let actualColumns = [];

    if (tableErr) {
      // Use a raw SQL approach via supabase.rpc or direct pg call.
      // We rely on an RPC wrapper; if unavailable, use a safe fallback
      // by querying the table directly.
      const { data: probeData, error: probeErr } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .limit(0);

      if (probeErr) {
        // Table does not exist or is inaccessible
        tableExists = false;
      } else {
        tableExists = true;
      }
    } else {
      tableExists = tableRows && tableRows.length > 0;
    }

    if (!tableExists) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          healthy: false,
          table: TABLE_NAME,
          tableExists: false,
          error: `Table "${SCHEMA_NAME}.${TABLE_NAME}" does not exist. A migration is required to create it.`,
          expectedColumns: Object.keys(EXPECTED_COLUMNS),
          checkedAt: new Date().toISOString(),
        }),
      };
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Retrieve actual columns from the table
    // ═══════════════════════════════════════════════════════════
    // Try information_schema first, fall back to a metadata probe.
    const { data: colRows, error: colErr } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_schema', SCHEMA_NAME)
      .eq('table_name', TABLE_NAME);

    if (colErr) {
      // Fallback: insert a dummy row (rolled back) or use the PostgREST
      // column headers. We use a lightweight probe: select with a filter
      // that returns no rows, then inspect the response structure.
      // PostgREST returns column names in its response even for zero rows.
      const { data: probeData, error: probeErr2 } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .limit(0);

      if (probeErr2) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            healthy: false,
            table: TABLE_NAME,
            tableExists: true,
            error: `Could not read column metadata: ${probeErr2.message}`,
            checkedAt: new Date().toISOString(),
          }),
        };
      }

      // PostgREST returns an empty array for zero rows, but we can try
      // a different approach: select each expected column individually.
      const columnCheckResults = {};
      for (const [colName, expectedType] of Object.entries(EXPECTED_COLUMNS)) {
        const { error: colTestErr } = await supabase
          .from(TABLE_NAME)
          .select(colName)
          .limit(0);

        if (colTestErr) {
          columnCheckResults[colName] = { exists: false, error: colTestErr.message };
        } else {
          columnCheckResults[colName] = { exists: true, expectedType, actualType: 'unknown (metadata unavailable)' };
        }
      }

      const missingColumns = Object.entries(columnCheckResults)
        .filter(([, info]) => !info.exists)
        .map(([name, info]) => ({ column: name, expectedType: EXPECTED_COLUMNS[name], error: info.error }));

      const presentColumns = Object.entries(columnCheckResults)
        .filter(([, info]) => info.exists)
        .map(([name]) => name);

      const healthy = missingColumns.length === 0;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          healthy,
          table: TABLE_NAME,
          tableExists: true,
          metadataSource: 'column-probe',
          presentColumns,
          missingColumns: healthy ? [] : missingColumns,
          message: healthy
            ? 'All expected columns are present (types not verifiable via probe).'
            : `MIGRATION REQUIRED: ${missingColumns.length} column(s) missing from "${TABLE_NAME}".`,
          migrationRequired: !healthy,
          checkedAt: new Date().toISOString(),
        }),
      };
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Full schema comparison (information_schema available)
    // ═══════════════════════════════════════════════════════════
    actualColumns = colRows || [];
    const actualMap = {};
    for (const col of actualColumns) {
      actualMap[col.column_name] = {
        data_type: col.data_type,
        is_nullable: col.is_nullable,
        column_default: col.column_default,
      };
    }

    const missingColumns = [];
    const typeMismatches = [];
    const presentColumns = [];

    for (const [colName, expectedType] of Object.entries(EXPECTED_COLUMNS)) {
      if (!actualMap[colName]) {
        missingColumns.push({
          column: colName,
          expectedType,
          status: 'MISSING',
        });
      } else {
        presentColumns.push({
          column: colName,
          expectedType,
          actualType: actualMap[colName].data_type,
          nullable: actualMap[colName].is_nullable,
          default: actualMap[colName].column_default,
        });

        if (actualMap[colName].data_type !== expectedType) {
          typeMismatches.push({
            column: colName,
            expectedType,
            actualType: actualMap[colName].data_type,
            status: 'TYPE_MISMATCH',
          });
        }
      }
    }

    // Check for extra columns not in our expected list
    const expectedNames = new Set(Object.keys(EXPECTED_COLUMNS));
    const extraColumns = actualColumns
      .filter((c) => !expectedNames.has(c.column_name))
      .map((c) => ({
        column: c.column_name,
        type: c.data_type,
        status: 'EXTRA',
      }));

    const healthy = missingColumns.length === 0 && typeMismatches.length === 0;

    const report = {
      healthy,
      table: TABLE_NAME,
      tableExists: true,
      metadataSource: 'information_schema',
      summary: {
        expectedColumnCount: Object.keys(EXPECTED_COLUMNS).length,
        presentCount: presentColumns.length,
        missingCount: missingColumns.length,
        typeMismatchCount: typeMismatches.length,
        extraColumnCount: extraColumns.length,
      },
      presentColumns,
      missingColumns: healthy ? [] : missingColumns,
      typeMismatches: healthy ? [] : typeMismatches,
      extraColumns,
      checkedAt: new Date().toISOString(),
    };

    if (!healthy) {
      const issues = [];
      if (missingColumns.length > 0) {
        issues.push(`${missingColumns.length} missing column(s): ${missingColumns.map((c) => c.column).join(', ')}`);
      }
      if (typeMismatches.length > 0) {
        issues.push(`${typeMismatches.length} type mismatch(es): ${typeMismatches.map((c) => `${c.column} (expected ${c.expectedType}, got ${c.actualType})`).join(', ')}`);
      }
      report.message = `MIGRATION REQUIRED: ${issues.join('; ')}.`;
      report.migrationRequired = true;
    } else {
      report.message = `Schema is healthy. All ${Object.keys(EXPECTED_COLUMNS).length} expected columns present with correct types.`;
      report.migrationRequired = false;
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Check additional tables with FULL type comparison
    // Uses information_schema when available so the M-3 Migration
    // Builder can detect type mismatches (e.g. cost as numeric
    // instead of integer) — not just missing columns.
    // ═══════════════════════════════════════════════════════════
    const additionalTableResults = [];

    for (const [tblName, expectedCols] of Object.entries(TABLES_TO_CHECK)) {
      if (tblName === TABLE_NAME) continue; // already checked above

      // Probe: does the table exist?
      const { error: tblProbeErr } = await supabase
        .from(tblName)
        .select('*')
        .limit(0);

      if (tblProbeErr) {
        additionalTableResults.push({
          table: tblName,
          tableExists: false,
          healthy: false,
          message: `Table "${SCHEMA_NAME}.${tblName}" does not exist or is inaccessible.`,
          migrationRequired: true,
        });
        continue;
      }

      // Try information_schema for full type comparison
      const { data: tblColRows, error: tblColErr } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_schema', SCHEMA_NAME)
        .eq('table_name', tblName);

      if (!tblColErr && tblColRows) {
        // ── Full type comparison path (information_schema available) ──
        const tblActualMap = {};
        for (const col of tblColRows) {
          tblActualMap[col.column_name] = {
            data_type: col.data_type,
            is_nullable: col.is_nullable,
            column_default: col.column_default,
          };
        }

        const tblMissing = [];
        const tblMismatches = [];
        const tblPresent = [];

        for (const [colName, expType] of Object.entries(expectedCols)) {
          if (!tblActualMap[colName]) {
            tblMissing.push({ column: colName, expectedType: expType, status: 'MISSING' });
          } else {
            tblPresent.push({
              column: colName,
              expectedType: expType,
              actualType: tblActualMap[colName].data_type,
              nullable: tblActualMap[colName].is_nullable,
              default: tblActualMap[colName].column_default,
            });
            if (tblActualMap[colName].data_type !== expType) {
              tblMismatches.push({
                column: colName,
                expectedType: expType,
                actualType: tblActualMap[colName].data_type,
                status: 'TYPE_MISMATCH',
              });
            }
          }
        }

        const tblHealthy = tblMissing.length === 0 && tblMismatches.length === 0;
        const issues = [];
        if (tblMissing.length > 0) {
          issues.push(`${tblMissing.length} missing column(s): ${tblMissing.map(c => c.column).join(', ')}`);
        }
        if (tblMismatches.length > 0) {
          issues.push(`${tblMismatches.length} type mismatch(es): ${tblMismatches.map(c => `${c.column} (expected ${c.expectedType}, got ${c.actualType})`).join(', ')}`);
        }

        additionalTableResults.push({
          table: tblName,
          tableExists: true,
          healthy: tblHealthy,
          metadataSource: 'information_schema',
          presentColumns: tblPresent,
          missingColumns: tblMissing,
          typeMismatches: tblMismatches,
          message: tblHealthy
            ? `All ${Object.keys(expectedCols).length} expected columns present with correct types.`
            : `MIGRATION REQUIRED: ${issues.join('; ')}.`,
          migrationRequired: !tblHealthy,
        });
      } else {
        // ── Fallback: column-probe only (no type info) ──
        const tblMissing = [];
        const tblPresent = [];
        for (const [colName, expType] of Object.entries(expectedCols)) {
          const { error: colErr2 } = await supabase
            .from(tblName)
            .select(colName)
            .limit(0);

          if (colErr2) {
            tblMissing.push({ column: colName, expectedType: expType });
          } else {
            tblPresent.push({ column: colName, expectedType: expType, actualType: 'unknown (metadata unavailable)' });
          }
        }

        const tblHealthy = tblMissing.length === 0;
        additionalTableResults.push({
          table: tblName,
          tableExists: true,
          healthy: tblHealthy,
          metadataSource: 'column-probe',
          presentColumns: tblPresent,
          missingColumns: tblMissing,
          typeMismatches: [],
          message: tblHealthy
            ? `All ${Object.keys(expectedCols).length} expected columns present (types not verifiable via probe).`
            : `MIGRATION REQUIRED: ${tblMissing.length} column(s) missing: ${tblMissing.map(c => c.column).join(', ')}.`,
          migrationRequired: !tblHealthy,
        });
      }
    }

    // Merge overall health: all tables must be healthy
    const overallHealthy = report.healthy && additionalTableResults.every((r) => r.healthy);
    report.overall_healthy = overallHealthy;
    report.additional_tables = additionalTableResults;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(report),
    };
  } catch (err) {
    console.error('[SCHEMA-HEALTH] Unhandled error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error during schema check' }),
    };
  }
};
