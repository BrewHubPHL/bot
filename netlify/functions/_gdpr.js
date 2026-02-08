/**
 * GDPR Helper Module
 * 
 * Provides utilities for "Right to be Forgotten" compliance.
 * Ensures Google Sheets can NEVER override the Supabase Source of Truth.
 * 
 * Architecture:
 * 1. Supabase is the Single Source of Truth (SSoT)
 * 2. deletion_tombstones table permanently records all GDPR deletions
 * 3. Any sync operation MUST check tombstones before upserting
 * 4. Google Sheets are downstream consumers only - never authoritative
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Check if a record is tombstoned (GDPR deleted).
 * Call this BEFORE any upsert from external sources.
 * 
 * @param {string} tableName - The table to check (e.g., 'customers', 'marketing_leads')
 * @param {string} key - The record key (usually email)
 * @returns {Promise<boolean>} - true if tombstoned (DO NOT IMPORT)
 */
async function isTombstoned(tableName, key) {
  if (!key) return false;
  
  const { data, error } = await supabase.rpc('is_tombstoned', {
    p_table: tableName,
    p_key: key.toLowerCase()
  });

  if (error) {
    console.error('[GDPR] Tombstone check failed:', error);
    // Fail-safe: if we can't check, assume it's tombstoned
    return true;
  }

  return data === true;
}

/**
 * Filter an array of records, removing any that are tombstoned.
 * Use this before bulk upserting data from external sources.
 * 
 * @param {string} tableName - The table to check
 * @param {Array} records - Array of records with an email/key field
 * @param {string} keyField - The field name containing the key (default: 'email')
 * @returns {Promise<Array>} - Records that are safe to import
 */
async function filterTombstoned(tableName, records, keyField = 'email') {
  if (!records || records.length === 0) return [];

  // Fetch all tombstones for this table
  const { data: tombstones, error } = await supabase
    .from('deletion_tombstones')
    .select('record_key')
    .eq('table_name', tableName);

  if (error) {
    console.error('[GDPR] Bulk tombstone lookup failed:', error);
    // Fail-safe: return empty array (don't import anything)
    return [];
  }

  const tombstoneSet = new Set((tombstones || []).map(t => t.record_key.toLowerCase()));
  
  const filtered = records.filter(record => {
    const key = (record[keyField] || '').toLowerCase();
    const isSafe = key && !tombstoneSet.has(key);
    if (!isSafe && key) {
      console.log(`[GDPR] Blocked zombie resurrection: ${key}`);
    }
    return isSafe;
  });

  console.log(`[GDPR] Filtered ${records.length - filtered.length} tombstoned records`);
  return filtered;
}

/**
 * Create a tombstone for a record (GDPR deletion).
 * This should be called BEFORE deleting the actual record.
 * 
 * @param {string} tableName - The table being deleted from
 * @param {string} key - The record key (usually email)
 * @param {string} deletedBy - Who performed the deletion (for audit)
 * @returns {Promise<boolean>} - true if tombstone created successfully
 */
async function createTombstone(tableName, key, deletedBy = 'system') {
  if (!key) return false;

  const { error } = await supabase
    .from('deletion_tombstones')
    .upsert({
      table_name: tableName,
      record_key: key.toLowerCase(),
      key_type: 'email',
      deleted_by: deletedBy,
      reason: 'GDPR Article 17 - Right to Erasure'
    }, { onConflict: 'table_name,record_key' });

  if (error) {
    console.error('[GDPR] Tombstone creation failed:', error);
    return false;
  }

  console.log(`[GDPR] Tombstone created: ${tableName}/${key}`);
  return true;
}

/**
 * Execute a full GDPR deletion using the database RPC.
 * This creates tombstones and deletes data across all related tables.
 * 
 * @param {string} email - The email to delete
 * @param {string} deletedBy - Who performed the deletion (for audit)
 * @returns {Promise<boolean>} - true if deletion completed
 */
async function executeGdprDeletion(email, deletedBy = 'system') {
  const { data, error } = await supabase.rpc('gdpr_delete_customer', {
    p_email: email,
    p_deleted_by: deletedBy
  });

  if (error) {
    console.error('[GDPR] Deletion RPC failed:', error);
    return false;
  }

  console.log(`[GDPR] Full deletion completed for: ${email}`);
  return true;
}

module.exports = {
  isTombstoned,
  filterTombstoned,
  createTombstone,
  executeGdprDeletion
};
