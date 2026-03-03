"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import StaffTable, { type StaffRow } from "./StaffTable";

/* ================================================================== */
/*  StaffSection – fetches from v_staff_status & renders StaffTable    */
/* ================================================================== */
export default function StaffSection() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: dbErr } = await supabase
        .from("v_staff_status")
        .select("id, name, full_name, email, phone, role, is_active, is_working, created_at")
        .order("full_name", { ascending: true });

      if (cancelled) return;

      if (dbErr) {
        setError(dbErr.message);
        setLoading(false);
        return;
      }

      setStaff((data as StaffRow[]) ?? []);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return <StaffTable staff={staff} loading={loading} error={error} />;
}
