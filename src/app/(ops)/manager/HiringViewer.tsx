"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User,
  MapPin,
  Clock,
  MessageSquare,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────── */
interface Applicant {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  availability: string | null;
  scenario_answer: string;
  resume_url: string | null;
  status: string;
  created_at: string;
}

const STATUS_OPTIONS = ["pending", "reviewed", "interview", "hired", "rejected"] as const;

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  reviewed:  "bg-sky-500/15   text-sky-400   border-sky-500/30",
  interview: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  hired:     "bg-green-500/15 text-green-400 border-green-500/30",
  rejected:  "bg-red-500/15   text-red-400   border-red-500/30",
};

/* ─── Main Component ─────────────────────────────────────── */
export default function HiringViewer() {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const fetchApplicants = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("job_applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setApplicants(data as Applicant[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApplicants();
  }, [fetchApplicants]);

  /* ── Status update ─────────────────────────────────────── */
  async function updateStatus(id: string, newStatus: string) {
    const { error } = await supabase
      .from("job_applications")
      .update({ status: newStatus })
      .eq("id", id);
    if (!error) {
      setApplicants((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      );
    }
  }

  /* ── Filtered list ─────────────────────────────────────── */
  const filtered =
    filterStatus === "all"
      ? applicants
      : applicants.filter((a) => a.status === filterStatus);

  /* ── Counts by status ──────────────────────────────────── */
  const counts: Record<string, number> = { all: applicants.length };
  for (const s of STATUS_OPTIONS) {
    counts[s] = applicants.filter((a) => a.status === s).length;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Applicants</h2>
          <p className="text-stone-500 text-sm">
            {applicants.length} total application{applicants.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={fetchApplicants}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-sm hover:bg-stone-700 transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {["all", ...STATUS_OPTIONS].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider border transition ${
              filterStatus === s
                ? "bg-amber-600/20 text-amber-400 border-amber-500/40"
                : "bg-stone-900 text-stone-500 border-stone-800 hover:border-stone-600"
            }`}
          >
            {s} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-20 bg-stone-900 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-600">
          <User size={40} className="mx-auto mb-3 opacity-40" />
          <p>No applications found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const expanded = expandedId === a.id;
            return (
              <div
                key={a.id}
                className="bg-stone-900/60 border border-stone-800 rounded-xl overflow-hidden transition hover:border-stone-700"
              >
                {/* Row header */}
                <button
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-stone-800 flex items-center justify-center text-stone-400 font-bold text-sm flex-shrink-0">
                      {a.name
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">
                        {a.name}
                      </div>
                      <div className="text-stone-500 text-xs truncate">
                        {a.email}
                        {a.phone && ` · ${a.phone}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {a.resume_url && (
                      <a
                        href={a.resume_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-stone-800 text-amber-400 text-xs font-medium hover:bg-stone-700 transition"
                        title="View Resume"
                      >
                        <FileText size={13} /> PDF
                      </a>
                    )}
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                        STATUS_STYLE[a.status] ?? STATUS_STYLE.pending
                      }`}
                    >
                      {a.status}
                    </span>
                    <span className="text-stone-600 text-xs whitespace-nowrap">
                      {new Date(a.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    {expanded ? (
                      <ChevronUp size={16} className="text-stone-600" />
                    ) : (
                      <ChevronDown size={16} className="text-stone-600" />
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {expanded && (
                  <div className="px-5 pb-5 pt-1 border-t border-stone-800 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-stone-500 text-xs font-semibold uppercase tracking-wider">
                          <Clock size={12} /> Availability
                        </div>
                        <p className="text-stone-300 text-sm">
                          {a.availability || "Not specified"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-stone-500 text-xs font-semibold uppercase tracking-wider">
                          <MapPin size={12} /> Vibe Check
                        </div>
                        <p className="text-stone-300 text-sm italic">
                          &ldquo;{a.scenario_answer}&rdquo;
                        </p>
                      </div>
                    </div>

                    {/* Status changer */}
                    <div className="flex items-center gap-3 pt-2">
                      <span className="text-xs text-stone-500 uppercase tracking-wider font-semibold">
                        Move to:
                      </span>
                      {STATUS_OPTIONS.filter((s) => s !== a.status).map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(a.id, s)}
                          className={`px-3 py-1 rounded-md text-xs font-medium border transition hover:opacity-80 ${
                            STATUS_STYLE[s]
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
