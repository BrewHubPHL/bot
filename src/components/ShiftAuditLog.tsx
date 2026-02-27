'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOpsSession } from '@/components/OpsGate';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  shift_id: string;
  action: 'created' | 'updated' | 'deleted';
  actor_name: string;
  affected_employee: string;
  changed_cols: string[] | null;
  shift_start: string | null;
  shift_end: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; icon: string; label: string }> = {
  created: { bg: 'bg-emerald-100 text-emerald-800', icon: '＋', label: 'Created' },
  updated: { bg: 'bg-blue-100 text-blue-800', icon: '✎', label: 'Moved' },
  deleted: { bg: 'bg-red-100 text-red-800', icon: '✕', label: 'Deleted' },
};

const FRIENDLY_COL_NAMES: Record<string, string> = {
  start_time: 'Start Time',
  end_time: 'End Time',
  status: 'Status',
  role_id: 'Role',
  location_id: 'Location',
  user_id: 'Employee',
};

const PAGE_SIZE = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function describeDelta(entry: AuditEntry): string | null {
  if (entry.action !== 'updated' || !entry.old_data || !entry.new_data) return null;
  if (!entry.changed_cols || entry.changed_cols.length === 0) return null;

  const parts: string[] = [];
  for (const col of entry.changed_cols) {
    const label = FRIENDLY_COL_NAMES[col] || col;
    if (col === 'start_time' || col === 'end_time') {
      parts.push(`${label}: ${formatTime(entry.old_data[col] as string)} → ${formatTime(entry.new_data[col] as string)}`);
    } else if (col === 'status') {
      parts.push(`Status: ${entry.old_data[col]} → ${entry.new_data[col]}`);
    } else {
      parts.push(`${label} changed`);
    }
  }
  return parts.join(' · ');
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ShiftAuditLog() {
  const { staff } = useOpsSession();
  const isManager = ['manager', 'admin'].includes(staff.role);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);

  const fetchAudit = useCallback(async (pageNum: number) => {
    setLoading(true);
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE;

    const { data, error } = await supabase
      .from('v_shift_audit_trail')
      .select('id, shift_id, action, actor_name, affected_employee, changed_cols, shift_start, shift_end, old_data, new_data, created_at')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (!error && data) {
      setEntries((prev) => (pageNum === 0 ? data as AuditEntry[] : [...prev, ...(data as AuditEntry[])]));
      setHasMore(data.length > PAGE_SIZE);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAudit(0);
  }, [fetchAudit]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchAudit(nextPage);
  };

  if (loading && entries.length === 0) {
    return (
      <div className="text-gray-400 text-sm py-8 text-center">Loading audit trail…</div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-gray-400 text-sm py-8 text-center">
        No schedule changes recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
          {isManager ? 'Schedule Audit Trail' : 'My Schedule Changes'}
        </h3>
        <button
          onClick={() => { setPage(0); fetchAudit(0); }}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" aria-hidden="true" />

        {entries.map((entry) => {
          const style = ACTION_STYLES[entry.action] ?? ACTION_STYLES.updated;
          const delta = describeDelta(entry);

          return (
            <div key={entry.id} className="relative pl-10 pb-4 group">
              {/* Timeline dot */}
              <div
                className={`absolute left-2 top-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${style.bg}`}
                title={style.label}
              >
                {style.icon}
              </div>

              {/* Card */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:border-gray-300 transition-colors">
                {/* Top row: action + actor + time */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-semibold ${style.bg}`}>
                    {style.label}
                  </span>
                  <span className="text-gray-600">
                    <span className="font-medium text-gray-800">{entry.actor_name}</span>
                    {entry.action === 'created' && <> assigned <span className="font-medium text-gray-800">{entry.affected_employee}</span></>}
                    {entry.action === 'updated' && <> moved <span className="font-medium text-gray-800">{entry.affected_employee}</span>&apos;s shift</>}
                    {entry.action === 'deleted' && <> removed <span className="font-medium text-gray-800">{entry.affected_employee}</span>&apos;s shift</>}
                  </span>
                  <span className="ml-auto text-gray-400 shrink-0" title={new Date(entry.created_at).toLocaleString()}>
                    {relativeTime(entry.created_at)}
                  </span>
                </div>

                {/* Shift time context */}
                {entry.shift_start && (
                  <div className="text-xs text-gray-500 mt-1">
                    {formatTime(entry.shift_start)}
                    {entry.shift_end && <> – {formatTime(entry.shift_end)}</>}
                  </div>
                )}

                {/* Change details (UPDATE only) */}
                {delta && (
                  <div className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 mt-1.5 font-mono">
                    {delta}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-2 text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load older changes'}
        </button>
      )}
    </div>
  );
}
