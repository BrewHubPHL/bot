'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast as sonnerToast } from 'sonner';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useOpsSession } from '@/components/OpsGate';
import { toUserSafeMessage } from '@/lib/errorCatalog';
import { fetchOps } from '@/utils/ops-api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawShift {
  id: string;
  user_id: string;
  employee_name: string;
  start_time: string;
  end_time: string;
  updated_at: string | null;
}

interface EmployeeInShift {
  shiftId: string;
  userId: string;
  name: string;
  updatedAt: string | null;
  startTime: string;
  endTime: string;
}

interface GroupedShiftEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  extendedProps: {
    employees: EmployeeInShift[];
  };
}

interface StaffMember {
  id: string;
  name: string;
  full_name: string | null;
  role: string;
}


// ─── Constants ───────────────────────────────────────────────────────────────

const MANAGER_ROLES = ['manager', 'admin'];
const MAX_VISIBLE_PILLS = 3;

const PILL_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-emerald-100 text-emerald-800',
  'bg-purple-100 text-purple-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-cyan-100 text-cyan-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800',
];

// ─── Utilities ───────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function getEmployeeColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return PILL_COLORS[Math.abs(hash) % PILL_COLORS.length];
}

/**
 * Convert an ISO timestamp (typically UTC from Supabase) to a bare datetime
 * string in America/New_York *without* an offset suffix.
 *
 * FullCalendar with `timeZone="America/New_York"` — but no timezone plugin —
 * positions events by their raw timestamp value when an offset is present.
 * By stripping the offset and expressing the time in ET, FullCalendar treats
 * the bare string as already in the target timezone and positions it correctly
 * on the grid.
 */
function toNaiveET(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Group individual shift rows by matching (start, end) into single calendar events */
function groupShiftsBySlot(rawShifts: RawShift[]): GroupedShiftEvent[] {
  const groups = new Map<string, RawShift[]>();
  for (const shift of rawShifts) {
    const key = `${shift.start_time}|${shift.end_time}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  }

  return Array.from(groups.entries()).map(([, shifts]) => {
    const employees: EmployeeInShift[] = shifts.map((s) => ({
      shiftId: s.id,
      userId: s.user_id,
      name: s.employee_name || 'Unknown',
      updatedAt: s.updated_at,
      startTime: s.start_time,
      endTime: s.end_time,
    }));

    return {
      id: shifts.map((s) => s.id).sort().join('|'),
      title: employees.map((e) => e.name).join(', '),
      start: toNaiveET(shifts[0].start_time),
      end: toNaiveET(shifts[0].end_time),
      backgroundColor: '#f8fafc',
      borderColor: '#3b82f6',
      textColor: '#1e293b',
      extendedProps: { employees },
    };
  });
}

/** Format ISO datetime → HH:MM in America/New_York for <input type="time"> */
function toTimeInputValue(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Format ISO datetime → readable date label in ET */
function toDateLabelET(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Get YYYY-MM-DD date part in America/New_York */
function toDatePartET(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Get the UTC offset string (e.g. "-05:00") for a date in America/New_York */
function getETOffset(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(iso));
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const match = tzPart.match(/GMT([+-])(\d+)/);
  if (!match) return '-05:00';
  return `${match[1]}${match[2].padStart(2, '0')}:00`;
}

/** Build an ISO string from a date (YYYY-MM-DD) + time (HH:MM) in ET.
 *  Computes the offset for the TARGET date+time (not a reference),
 *  so DST transitions (e.g. March 8 spring-forward) resolve correctly. */
function buildISOFromET(datePart: string, time: string): string {
  // First pass: assume EST (-05:00) to get a rough UTC moment
  const rough = new Date(`${datePart}T${time}:00-05:00`);
  // Second pass: compute the ACTUAL ET offset for that moment
  const offset = getETOffset(rough.toISOString());
  return `${datePart}T${time}:00${offset}`;
}

/**
 * Ensure a FullCalendar datetime string carries the correct ET offset.
 * FullCalendar with timeZone="America/New_York" emits bare strings like
 * "2026-03-05T06:00:00" (no Z, no offset). If we send these to the
 * backend, `new Date()` parses them relative to the SERVER's timezone,
 * causing ±5h drift. This helper detects bare strings and appends the
 * correct ET offset so the backend always receives an unambiguous ISO
 * timestamp.
 */
function ensureETOffset(dateStr: string): string {
  if (!dateStr) return dateStr;
  // Already has 'Z' or an explicit offset (+HH:MM / -HH:MM) → leave as-is
  if (/Z$/.test(dateStr) || /[+-]\d{2}:\d{2}$/.test(dateStr)) return dateStr;
  // Extract date + time components from e.g. "2026-03-05T06:00:00"
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return dateStr;
  return buildISOFromET(match[1], match[2]);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCalendar() {
  const { staff: sessionStaff, token } = useOpsSession();
  const isManager = MANAGER_ROLES.includes(sessionStaff.role);

  // ── Data state ───────────────────────────────────────────────────────────
  const [rawShifts, setRawShifts] = useState<RawShift[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Derived: grouped events for FullCalendar ───────────────────────────
  const events = useMemo(() => groupShiftsBySlot(rawShifts), [rawShifts]);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'manage'>('create');
  const [selectedRange, setSelectedRange] = useState({ start: '', end: '' });
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<EmployeeInShift[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ── Inline time-editing state (manage modal) ─────────────────────────────
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  // ── Tooltip state ────────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    employees: EmployeeInShift[];
  } | null>(null);

  const eventDropLockRef = useRef(false);

  // ── Toast helper (delegates to Sonner) ───────────────────────────────────

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    if (type === 'success') sonnerToast.success(msg);
    else sonnerToast.error(msg);
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchShifts = useCallback(async () => {
    try {
      const res = await fetchOps('/manage-schedule', { method: 'GET' }, token);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFetchError(toUserSafeMessage(body.error || res.statusText, 'Failed to load shifts.'));
        return;
      }
      const { shifts } = await res.json();
      setRawShifts(
        (shifts ?? []).map((s: Record<string, string | null>) => ({
          id: s.id as string,
          user_id: s.user_id as string,
          employee_name: (s.employee_name ?? 'Unknown') as string,
          start_time: s.start_time as string,
          end_time: s.end_time as string,
          updated_at: s.updated_at,
        })),
      );
      setFetchError(null);
    } catch {
      setFetchError('Network error loading shifts.');
    }
  }, [token]);

  const fetchStaff = useCallback(async () => {
    // Fetch ALL staff for the dropdown (not filtered by is_working — managers
    // schedule people who aren't currently on the clock)
    try {
      const res = await fetchOps('/manage-schedule?type=staff', { method: 'GET' }, token);
      if (!res.ok) return;
      const { staff } = await res.json();
      if (staff) setStaff(staff as StaffMember[]);
    } catch {
      // Silent — staff dropdown just stays empty
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([fetchShifts(), isManager ? fetchStaff() : Promise.resolve()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchShifts, fetchStaff, isManager]);

  // ── Reset editing state when modal closes ─────────────────────────────────

  useEffect(() => {
    if (!isModalOpen) {
      setEditingShiftId(null);
      setEditStart('');
      setEditEnd('');
    }
  }, [isModalOpen]);

  // Escape handling is built into Shadcn Dialog

  // ── Multi-select toggle ──────────────────────────────────────────────────

  const toggleUser = useCallback((userId: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  // ── Calendar handlers (manager-only at prop level + runtime guard) ───────

  const handleDateSelect = useCallback(
    (info: { startStr: string; endStr: string; view: { calendar: { unselect: () => void } } }) => {
      if (!isManager) return;
      setSelectedRange({ start: info.startStr, end: info.endStr });
      setModalMode('create');
      setSelectedUsers(new Set());
      setIsModalOpen(true);
      info.view.calendar.unselect();
    },
    [isManager],
  );

  const handleEventClick = useCallback(
    (info: { event: { extendedProps: Record<string, unknown> } }) => {
      if (!isManager) return;
      const employees = (info.event.extendedProps.employees as EmployeeInShift[]) ?? [];
      if (employees.length === 0) return;
      setSelectedGroup([...employees]);
      setModalMode('manage');
      setIsModalOpen(true);
    },
    [isManager],
  );

  const handleEventDrop = useCallback(
    async (info: {
      event: {
        id: string;
        startStr: string;
        endStr: string;
        extendedProps: Record<string, unknown>;
      };
      revert: () => void;
    }) => {
      // 1. RBAC Guard
      if (!isManager) {
        info.revert();
        return;
      }
      // 2. Dual-Lock Guard
      if (eventDropLockRef.current) {
        info.revert();
        return;
      }
      eventDropLockRef.current = true;

      const { event, revert } = info;
      const employees = event.extendedProps.employees as EmployeeInShift[];
      const shiftIds = employees.map((e) => e.shiftId);

      try {
        // Fire concurrent PATCH requests for EACH shift in the group.
        // The backend expects `id` (single), not `shift_ids` (array).
        const results = await Promise.all(
          shiftIds.map((id) =>
            fetchOps(
              '/manage-schedule',
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: id,
                  start_time: ensureETOffset(event.startStr),
                  end_time: ensureETOffset(event.endStr),
                }),
              },
              token
            )
          )
        );

        // If ANY of the concurrent patch requests fail, revert the entire visual drag
        if (results.some((res) => !res.ok)) {
          showToast('Failed to move some shifts. Reverting...', 'error');
          revert();
          await fetchShifts();
          return;
        }
      } catch {
        showToast('Network error moving shift(s).', 'error');
        revert();
        await fetchShifts();
        return;
      } finally {
        eventDropLockRef.current = false;
      }

      // 3. Sync & Confirm
      await fetchShifts();
      showToast(`Moved ${shiftIds.length} shift(s)`, 'success');
    },
    [isManager, showToast, fetchShifts, token],
  );

  // ── Modal submissions ────────────────────────────────────────────────────

  const handleCreateShift = useCallback(async () => {
    if (selectedUsers.size === 0) {
      showToast('Please select at least one employee.', 'error');
      return;
    }

    const userIds = Array.from(selectedUsers);

    setSubmitting(true);
    try {
      const res = await fetchOps('/manage-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: userIds,
          start_time: ensureETOffset(selectedRange.start),
          end_time: ensureETOffset(selectedRange.end),
          location_id: 'brewhub_main',
        }),
      }, token);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(
          toUserSafeMessage(body.error || res.statusText, 'Failed to create shift(s) — may overlap existing ones.'),
          'error',
        );
        return;
      }
    } catch {
      showToast('Network error creating shift(s).', 'error');
      return;
    } finally {
      setSubmitting(false);
    }

    setIsModalOpen(false);
    const count = selectedUsers.size;
    showToast(`${count} shift${count !== 1 ? 's' : ''} created`, 'success');
    await fetchShifts();
  }, [selectedUsers, selectedRange, showToast, fetchShifts, token]);

  const handleRemoveFromGroup = useCallback(
    async (shiftId: string) => {
      setSubmitting(true);
      try {
        const res = await fetchOps('/manage-schedule', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: shiftId }),
        }, token);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          showToast(
            toUserSafeMessage(body.error || res.statusText, 'Failed to remove employee.'),
            'error',
          );
          return;
        }
      } catch {
        showToast('Network error removing employee.', 'error');
        return;
      } finally {
        setSubmitting(false);
      }

      const remaining = selectedGroup.filter((e) => e.shiftId !== shiftId);
      setSelectedGroup(remaining);
      showToast('Employee removed from shift', 'success');
      await fetchShifts();

      if (remaining.length === 0) {
        setIsModalOpen(false);
      }
    },
    [showToast, fetchShifts, token, selectedGroup],
  );

  const handleDeleteAllInGroup = useCallback(async () => {
    const ids = selectedGroup.map((e) => e.shiftId);
    if (ids.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetchOps('/manage-schedule', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }, token);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(
          toUserSafeMessage(body.error || res.statusText, 'Failed to delete shifts.'),
          'error',
        );
        return;
      }
    } catch {
      showToast('Network error deleting shifts.', 'error');
      return;
    } finally {
      setSubmitting(false);
    }

    setIsModalOpen(false);
    showToast('All shifts deleted', 'success');
    await fetchShifts();
  }, [selectedGroup, showToast, fetchShifts, token]);

  // ── Individual time editing ──────────────────────────────────────────────

  const handleUpdateShiftTime = useCallback(
    async (shiftId: string) => {
      if (!editStart || !editEnd) {
        showToast('Please set both start and end times.', 'error');
        return;
      }
      if (editEnd <= editStart) {
        showToast('End time must be after start time.', 'error');
        return;
      }

      const emp = selectedGroup.find((e) => e.shiftId === shiftId);
      if (!emp) return;

      const datePart = toDatePartET(emp.startTime);
      const startISO = buildISOFromET(datePart, editStart);
      const endISO = buildISOFromET(datePart, editEnd);

      setSubmitting(true);
      try {
        const res = await fetchOps('/manage-schedule', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: shiftId,
            start_time: startISO,
            end_time: endISO,
          }),
        }, token);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          showToast(
            toUserSafeMessage(body.error || res.statusText, 'Failed to update shift time.'),
            'error',
          );
          return;
        }
      } catch {
        showToast('Network error updating shift time.', 'error');
        return;
      } finally {
        setSubmitting(false);
      }

      setEditingShiftId(null);
      showToast('Shift time updated', 'success');
      setIsModalOpen(false);
      await fetchShifts();
    },
    [editStart, editEnd, selectedGroup, showToast, fetchShifts, token],
  );

  // ── Tooltip handlers ─────────────────────────────────────────────────────

  const handleEventMouseEnter = useCallback(
    (info: { el: HTMLElement; event: { extendedProps: Record<string, unknown> } }) => {
      const employees = (info.event.extendedProps.employees as EmployeeInShift[]) ?? [];
      if (employees.length <= 1) return; // No tooltip needed for single employee
      const rect = info.el.getBoundingClientRect();
      const tooltipWidth = 220;
      const x =
        rect.right + 8 + tooltipWidth > window.innerWidth
          ? rect.left - tooltipWidth - 8
          : rect.right + 8;
      setTooltip({ x, y: rect.top, employees });
    },
    [],
  );

  const handleEventMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  // ── Custom event content renderer ────────────────────────────────────────

  const renderEventContent = useCallback(
    (arg: { event: { extendedProps: Record<string, unknown> } }) => {
      const employees = (arg.event.extendedProps.employees as EmployeeInShift[]) ?? [];
      if (employees.length === 0) return null;
      const visible = employees.slice(0, MAX_VISIBLE_PILLS);
      const overflow = employees.length - MAX_VISIBLE_PILLS;

      return (
        <div className="flex flex-wrap gap-1 p-1 overflow-hidden w-full h-full items-start">
          {visible.map((emp) => (
            <span
              key={emp.shiftId}
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-tight whitespace-nowrap ${getEmployeeColor(emp.userId)}`}
              title={emp.name}
            >
              {employees.length === 1 ? emp.name : getInitials(emp.name)}
            </span>
          ))}
          {overflow > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-600">
              +{overflow}
            </span>
          )}
        </div>
      );
    },
    [],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-400 text-lg">
        Loading schedule…
      </div>
    );
  }

  return (
    <div
      className="relative text-black w-full bg-white p-4 rounded-lg shadow-md flex flex-col border border-gray-200"
      style={{ height: '85vh', minHeight: '700px' }}
    >
      {/* ── Read-only banner (baristas / employees) ── */}
      {!isManager && (
        <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm font-medium text-center">
          View Only — contact a manager to change the schedule
        </div>
      )}

      {/* ── Fetch error banner with retry ── */}
      {fetchError && (
        <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm flex items-center justify-between">
          <span>{fetchError}</span>
          <button
            onClick={() => {
              setFetchError(null);
              fetchShifts();
            }}
            className="ml-4 underline font-semibold hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

      <style>{`
        .fc-timegrid-event {
          min-height: 44px !important;
          cursor: ${isManager ? 'pointer' : 'default'};
        }
        .fc .fc-timegrid-col.fc-day-today {
          background-color: rgba(255, 248, 220, 0.4);
        }
        .fc-event-main { padding: 0 !important; }
        ${
          !isManager
            ? `
        /* Read-only visual cues for non-managers */
        .fc .fc-timegrid-slot { cursor: default !important; }
        .fc .fc-highlight { display: none !important; }
        .fc-event { pointer-events: none; opacity: 0.85; }
        `
            : ''
        }
      `}</style>

      <div className="flex-grow h-full w-full overflow-hidden">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          timeZone="America/New_York"
          events={events}
          eventContent={renderEventContent}
          /* ── Explicit ET time formatting (12h with AM/PM) ── */
          slotLabelFormat={{ hour: 'numeric', minute: '2-digit', hour12: true }}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', hour12: true }}
          nowIndicator={true}
          /* ── RBAC: conditionally enable interaction ── */
          editable={isManager}
          selectable={isManager}
          selectMirror={isManager}
          /* ── Mobile: long-press thresholds to avoid accidental edits ── */
          selectLongPressDelay={350}
          eventLongPressDelay={350}
          /* ── Handlers: only wired when manager ── */
          select={isManager ? handleDateSelect : undefined}
          eventClick={isManager ? handleEventClick : undefined}
          eventDrop={isManager ? handleEventDrop : undefined}
          eventResize={isManager ? handleEventDrop : undefined}
          /* ── Tooltip peek on hover ── */
          eventMouseEnter={handleEventMouseEnter}
          eventMouseLeave={handleEventMouseLeave}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay',
          }}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          height="100%"
        />
        {/* Timezone indicator anchored below calendar header */}
        <div className="absolute top-[58px] right-4 text-[10px] font-medium text-gray-400 tracking-wide pointer-events-none select-none">
          Eastern Time (ET)
        </div>
      </div>

      {/* ── Hover tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-[60] bg-gray-900 text-white rounded-lg shadow-xl py-2.5 px-3.5 pointer-events-none"
          style={{ top: tooltip.y, left: tooltip.x, minWidth: 160 }}
        >
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Staff on Shift
          </div>
          {tooltip.employees.map((emp) => (
            <div key={emp.shiftId} className="flex items-center gap-2 py-0.5">
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold ${getEmployeeColor(emp.userId)}`}
              >
                {getInitials(emp.name)}
              </span>
              <span className="text-sm">{emp.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal (managers only — defense-in-depth) ── */}
      <Dialog open={isModalOpen && isManager} onOpenChange={setIsModalOpen}>
        <DialogContent
          className="bg-white sm:max-w-[420px] border-gray-300"
          aria-label={modalMode === 'create' ? 'Assign New Shift' : 'Manage Shift'}
        >
          <DialogHeader>
            <DialogTitle>
              {modalMode === 'create' ? 'Assign New Shift' : 'Manage Shift'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {modalMode === 'create' ? 'Select employees and confirm shift creation' : 'Edit or remove employees from this shift'}
            </DialogDescription>
          </DialogHeader>

            {/* ── Create mode: multi-select checkboxes ── */}
            {modalMode === 'create' && (
              <div className="mb-6">
                {/* Selected time range in ET */}
                {selectedRange.start && (
                  <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                    <span className="font-semibold">
                      {toDateLabelET(selectedRange.start)}
                    </span>
                    {' · '}
                    {toTimeInputValue(selectedRange.start)} – {toTimeInputValue(selectedRange.end)}
                    <span className="text-blue-500 text-xs ml-1">(ET)</span>
                  </div>
                )}
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Select Employees
                </label>
                <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                  {staff.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.has(s.id)}
                        onChange={() => toggleUser(s.id)}
                        disabled={submitting}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-800">
                        {s.full_name || s.name}
                      </span>
                      <span className="text-xs text-gray-500 ml-auto">{s.role}</span>
                    </label>
                  ))}
                </div>
                {selectedUsers.size > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    {selectedUsers.size} employee{selectedUsers.size !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            )}

            {/* ── Manage mode: employee list with edit time + remove ── */}
            {modalMode === 'manage' && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-1">Employees on this shift:</p>
                {selectedGroup.length > 0 && (
                  <p className="text-xs text-gray-400 mb-3">
                    {toDateLabelET(selectedGroup[0].startTime)}
                    {' · '}
                    {toTimeInputValue(selectedGroup[0].startTime)} – {toTimeInputValue(selectedGroup[0].endTime)}
                    {' '}(ET)
                  </p>
                )}
                <div className="space-y-2">
                  {selectedGroup.map((emp) => (
                    <div key={emp.shiftId} className="bg-gray-50 rounded-md px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${getEmployeeColor(emp.userId)}`}
                          >
                            {getInitials(emp.name)}
                          </span>
                          <span className="text-sm font-medium">{emp.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {editingShiftId !== emp.shiftId && (
                            <button
                              onClick={() => {
                                setEditingShiftId(emp.shiftId);
                                setEditStart(toTimeInputValue(emp.startTime));
                                setEditEnd(toTimeInputValue(emp.endTime));
                              }}
                              disabled={submitting}
                              className="text-blue-500 hover:text-blue-700 text-xs font-semibold disabled:opacity-50"
                            >
                              Edit Time
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveFromGroup(emp.shiftId)}
                            disabled={submitting}
                            className="text-red-500 hover:text-red-700 text-xs font-semibold disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {/* Current time display (when not editing this shift) */}
                      {editingShiftId !== emp.shiftId && (
                        <div className="mt-1 ml-8 text-xs text-gray-500">
                          {toTimeInputValue(emp.startTime)} – {toTimeInputValue(emp.endTime)}
                        </div>
                      )}
                      {/* Inline time editor */}
                      {editingShiftId === emp.shiftId && (
                        <div className="mt-2 ml-8 flex items-center gap-2 flex-wrap">
                          <label className="text-xs text-gray-600 flex items-center gap-1">
                            Start
                            <Input
                              type="time"
                              value={editStart}
                              onChange={(e) => setEditStart(e.target.value)}
                              disabled={submitting}
                              className="h-8 w-auto px-2 py-1 text-sm"
                            />
                          </label>
                          <label className="text-xs text-gray-600 flex items-center gap-1">
                            End
                            <Input
                              type="time"
                              value={editEnd}
                              onChange={(e) => setEditEnd(e.target.value)}
                              disabled={submitting}
                              className="h-8 w-auto px-2 py-1 text-sm"
                            />
                          </label>
                          <button
                            onClick={() => handleUpdateShiftTime(emp.shiftId)}
                            disabled={submitting || !editStart || !editEnd}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                          >
                            {submitting ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingShiftId(null)}
                            disabled={submitting}
                            className="px-2 py-1 text-gray-600 text-xs font-semibold hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between mt-4">
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={submitting}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-semibold disabled:opacity-50"
              >
                Cancel
              </button>

              {modalMode === 'create' ? (
                <button
                  onClick={handleCreateShift}
                  disabled={submitting || selectedUsers.size === 0}
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold disabled:opacity-50"
                >
                  {submitting
                    ? 'Creating…'
                    : `Confirm${selectedUsers.size > 1 ? ` (${selectedUsers.size})` : ''}`}
                </button>
              ) : (
                <button
                  onClick={handleDeleteAllInGroup}
                  disabled={submitting || selectedGroup.length === 0}
                  className="px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-bold disabled:opacity-50"
                >
                  {submitting ? 'Deleting…' : `Delete All (${selectedGroup.length})`}
                </button>
              )}
            </div>
        </DialogContent>
      </Dialog>

      {/* ── Toast notification ── */}
    </div>
  );
}