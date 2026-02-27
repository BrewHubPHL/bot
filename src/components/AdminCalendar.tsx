'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { supabase } from '@/lib/supabase';
import { useOpsSession } from '@/components/OpsGate';
import { toUserSafeMessage } from '@/lib/errorCatalog';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ShiftEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  extendedProps: {
    userId: string;
    updatedAt: string | null;
  };
}

interface StaffMember {
  id: string;
  name: string;
  full_name: string | null;
  role: string;
}

type ToastState = { msg: string; type: 'success' | 'error' } | null;

// ─── Constants ───────────────────────────────────────────────────────────────

const MANAGER_ROLES = ['manager', 'admin'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCalendar() {
  const { staff: sessionStaff } = useOpsSession();
  const isManager = MANAGER_ROLES.includes(sessionStaff.role);

  // ── Data state ───────────────────────────────────────────────────────────
  const [events, setEvents] = useState<ShiftEvent[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'delete'>('create');
  const [selectedRange, setSelectedRange] = useState({ start: '', end: '' });
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Toast state ──────────────────────────────────────────────────────────
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Toast helper ─────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchShifts = useCallback(async () => {
    // Use the pre-joined view (schema-63) instead of broken PostgREST join
    const { data, error } = await supabase
      .from('v_scheduled_shifts_with_staff')
      .select('id, user_id, start_time, end_time, role_id, status, updated_at, employee_name');

    if (error) {
      setFetchError(toUserSafeMessage(error.message, 'Failed to load shifts.'));
      return;
    }

    setEvents(
      (data ?? []).map((s) => ({
        id: s.id,
        title: s.employee_name ?? 'Unknown',
        start: s.start_time,
        end: s.end_time,
        extendedProps: { userId: s.user_id, updatedAt: s.updated_at },
      })),
    );
    setFetchError(null);
  }, []);

  const fetchStaff = useCallback(async () => {
    // Fetch ALL staff for the dropdown (not filtered by is_working — managers
    // schedule people who aren't currently on the clock)
    const { data, error } = await supabase
      .from('staff_directory_safe')
      .select('id, name, full_name, role');

    if (!error && data) setStaff(data as StaffMember[]);
  }, []);

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

  // ── Keyboard: Escape closes modal ────────────────────────────────────────

  useEffect(() => {
    if (!isModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isModalOpen]);

  // ── Calendar handlers (manager-only at prop level + runtime guard) ───────

  const handleDateSelect = useCallback(
    (info: { startStr: string; endStr: string; view: { calendar: { unselect: () => void } } }) => {
      if (!isManager) return;
      setSelectedRange({ start: info.startStr, end: info.endStr });
      setModalMode('create');
      setSelectedUser('');
      setIsModalOpen(true);
      info.view.calendar.unselect();
    },
    [isManager],
  );

  const handleEventClick = useCallback(
    (info: { event: { id: string } }) => {
      if (!isManager) return;
      setSelectedShiftId(info.event.id);
      setModalMode('delete');
      setIsModalOpen(true);
    },
    [isManager],
  );

  const handleEventDrop = useCallback(
    async (info: {
      event: { id: string; startStr: string; endStr: string; extendedProps: Record<string, unknown> };
      revert: () => void;
    }) => {
      if (!isManager) {
        info.revert();
        return;
      }

      const { event, revert } = info;
      const prevUpdatedAt = event.extendedProps.updatedAt as string | null;

      // Optimistic concurrency: only update if updated_at still matches
      let query = supabase
        .from('scheduled_shifts')
        .update({ start_time: event.startStr, end_time: event.endStr })
        .eq('id', event.id);

      if (prevUpdatedAt) {
        query = query.eq('updated_at', prevUpdatedAt);
      }

      const { data, error: updateErr } = await query.select('id').maybeSingle();

      if (updateErr || !data) {
        showToast(
          updateErr
            ? toUserSafeMessage(updateErr.message, 'Could not move shift.')
            : 'Conflict — another manager changed this shift. Refreshing…',
          'error',
        );
        revert();
        await fetchShifts();
        return;
      }

      await fetchShifts();
      showToast('Shift moved', 'success');
    },
    [isManager, showToast, fetchShifts],
  );

  // ── Modal submissions ────────────────────────────────────────────────────

  const handleCreateShift = useCallback(async () => {
    if (!selectedUser) {
      showToast('Please select an employee.', 'error');
      return;
    }

    const employee = staff.find((s) => s.id === selectedUser);
    if (!employee) return;

    setSubmitting(true);
    const { error } = await supabase.from('scheduled_shifts').insert({
      user_id: employee.id,
      role_id: employee.role,
      start_time: selectedRange.start,
      end_time: selectedRange.end,
      location_id: 'brewhub_main',
      status: 'scheduled',
    });
    setSubmitting(false);

    if (error) {
      showToast(
        toUserSafeMessage(error.message, 'Failed to create shift — may overlap an existing one.'),
        'error',
      );
      return;
    }

    setIsModalOpen(false);
    showToast('Shift created', 'success');
    await fetchShifts();
  }, [selectedUser, staff, selectedRange, showToast, fetchShifts]);

  const handleDeleteShift = useCallback(async () => {
    if (!selectedShiftId) return;

    setSubmitting(true);
    const { error } = await supabase
      .from('scheduled_shifts')
      .delete()
      .eq('id', selectedShiftId);
    setSubmitting(false);

    if (error) {
      showToast(toUserSafeMessage(error.message, 'Failed to delete shift.'), 'error');
      return;
    }

    setIsModalOpen(false);
    showToast('Shift deleted', 'success');
    await fetchShifts();
  }, [selectedShiftId, showToast, fetchShifts]);

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
      </div>

      {/* ── Modal (managers only — defense-in-depth) ── */}
      {isModalOpen && isManager && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setIsModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={modalMode === 'create' ? 'Assign New Shift' : 'Manage Shift'}
        >
          <div
            className="bg-white p-6 rounded-lg shadow-xl w-96 border border-gray-300"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">
              {modalMode === 'create' ? 'Assign New Shift' : 'Manage Shift'}
            </h2>

            {modalMode === 'create' && (
              <div className="mb-6">
                <label
                  htmlFor="shift-staff-select"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Select Employee
                </label>
                <select
                  id="shift-staff-select"
                  className="w-full border border-gray-300 p-3 rounded-md text-lg"
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">-- Choose Staff --</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name || s.name} ({s.role})
                    </option>
                  ))}
                </select>
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
                  disabled={submitting || !selectedUser}
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create Shift'}
                </button>
              ) : (
                <button
                  onClick={handleDeleteShift}
                  disabled={submitting}
                  className="px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-bold disabled:opacity-50"
                >
                  {submitting ? 'Deleting…' : 'Delete Shift'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={[
            'fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl',
            'flex items-center gap-3 text-sm font-semibold transition-all duration-300',
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white',
          ].join(' ')}
        >
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}