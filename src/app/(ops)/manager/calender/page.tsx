'use client';

import AdminCalendar from '@/components/AdminCalendar';
import ShiftAuditLog from '@/components/ShiftAuditLog';
import { useState } from 'react';

export default function SchedulePage() {
  const [showAudit, setShowAudit] = useState(false);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Employee Schedule</h1>
          <p className="text-gray-400">View and manage the weekly shift schedule.</p>
        </div>
        <button
          onClick={() => setShowAudit((v) => !v)}
          className="px-3 py-1.5 text-xs font-semibold rounded border transition-colors
                     border-stone-600 text-stone-400 hover:border-amber-500 hover:text-amber-400"
        >
          {showAudit ? 'Hide' : 'Show'} Audit Trail
        </button>
      </div>

      {/* Calendar */}
      <AdminCalendar />

      {/* Collapsible Audit Trail */}
      {showAudit && (
        <div className="mt-6 bg-white rounded-lg shadow-md border border-gray-200 p-4 max-h-[60vh] overflow-y-auto">
          <ShiftAuditLog />
        </div>
      )}
    </div>
  );
}