'use client';

import AdminCalendar from '@/components/AdminCalendar';
import ShiftAuditLog from '@/components/ShiftAuditLog';
import { useState } from 'react';

export default function SchedulePage() {
  const [showAudit, setShowAudit] = useState(false);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto flex flex-col h-screen">
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Employee Schedule</h1>
          <p className="text-gray-400 text-sm">View and manage the weekly shift schedule.</p>
        </div>
        <button
          onClick={() => setShowAudit((v) => !v)}
          className="px-3 py-1.5 text-xs font-semibold rounded border transition-colors
                     border-stone-600 text-stone-400 hover:border-amber-500 hover:text-amber-400"
        >
          {showAudit ? 'Hide' : 'Show'} Audit Trail
        </button>
      </div>

      {/* Calendar Wrapper: 
        1. flex-1 and min-h-[600px] ensures the calendar stretches tall enough so events aren't vertically squished.
        2. [&_.rbc-event-content]:whitespace-normal overrides the default nowrap so text wraps to multiple lines.
        3. Break-words and leading-tight make those tiny 33%-wide events actually readable!
      */}
      <div className="
        flex-1 min-h-[600px] bg-white rounded-lg p-2 sm:p-4 shadow-xl overflow-hidden
        [&_.rbc-event]:rounded-md
        [&_.rbc-event-content]:whitespace-normal 
        [&_.rbc-event-content]:break-words 
        [&_.rbc-event-content]:leading-tight
        [&_.rbc-event-content]:text-xs
        [&_.rbc-time-view]:bg-white
      ">
        <AdminCalendar />
      </div>

      {/* Collapsible Audit Trail */}
      {showAudit && (
        <div className="mt-6 bg-white rounded-lg shadow-md border border-gray-200 p-4 max-h-[40vh] overflow-y-auto shrink-0">
          <ShiftAuditLog />
        </div>
      )}
    </div>
  );
}