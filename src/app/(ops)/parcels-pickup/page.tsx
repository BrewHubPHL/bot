"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOpsSession } from "@/components/OpsGate";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import { canConfirmParcelPickup, pickupGateReason } from "@/lib/parcelPickupGate";

interface ArrivedParcel {
  id: string;
  tracking_number: string | null;
  recipient_name: string | null;
  unit_number: string | null;
  status: string;
  received_at: string | null;
  estimated_value_tier: string;
}

interface PickupFormState {
  pickupCode: string;
  collectorName: string;
  idLast4: string;
  requireIdFields: boolean;
  busy: boolean;
  error: string | null;
  success: string | null;
}

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

const EMPTY_FORM: PickupFormState = {
  pickupCode: "",
  collectorName: "",
  idLast4: "",
  requireIdFields: false,
  busy: false,
  error: null,
  success: null,
};

export default function ParcelsPickupPage() {
  const { token } = useOpsSession();

  const [parcels, setParcels] = useState<ArrivedParcel[]>([]);
  const [forms, setForms] = useState<Record<string, PickupFormState>>({});
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [freshnessTtlMs, setFreshnessTtlMs] = useState<number>(60_000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null);

  const statusIsFresh = useMemo(
    () => (snapshotAt ? canConfirmParcelPickup("arrived", snapshotAt, Date.now(), freshnessTtlMs) : false),
    [snapshotAt, freshnessTtlMs],
  );

  const getForm = useCallback((parcelId: string): PickupFormState => forms[parcelId] ?? EMPTY_FORM, [forms]);

  const patchForm = useCallback((parcelId: string, patch: Partial<PickupFormState>) => {
    setForms((prev) => ({
      ...prev,
      [parcelId]: { ...(prev[parcelId] ?? EMPTY_FORM), ...patch },
    }));
  }, []);

  const loadParcels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/get-arrived-parcels`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
      });

      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Unable to load arrived parcels right now.");
        setAuthzState(info.authz);
        setError(info.authz ? null : info.message);
        return;
      }

      const body = (await res.json()) as {
        parcels?: ArrivedParcel[];
        snapshot_at?: string;
        freshness_ttl_ms?: number;
      };

      setParcels(Array.isArray(body.parcels) ? body.parcels : []);
      setSnapshotAt(body.snapshot_at ?? new Date().toISOString());
      setFreshnessTtlMs(typeof body.freshness_ttl_ms === "number" ? body.freshness_ttl_ms : 60_000);
      setAuthzState(null);
      setError(null);
    } catch (err: unknown) {
      setAuthzState(null);
      setError(toUserSafeMessageFromUnknown(err, "Unable to load arrived parcels right now."));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadParcels();
  }, [loadParcels]);

  const PICKUP_CODE_RE = /^\d{6}$/;

  const handleConfirmPickup = useCallback(async (parcel: ArrivedParcel) => {
    const form = getForm(parcel.id);
    const gateReason = pickupGateReason(parcel.status, snapshotAt, Date.now(), freshnessTtlMs);
    if (gateReason) {
      patchForm(parcel.id, { error: gateReason, success: null });
      // M2: auto-resync on stale-snapshot gate
      loadParcels();
      return;
    }

    // M2: strict 6-digit numeric validation before network call
    if (!PICKUP_CODE_RE.test(form.pickupCode.trim())) {
      patchForm(parcel.id, { error: "Pickup code must be exactly 6 digits.", success: null });
      return;
    }

    patchForm(parcel.id, { busy: true, error: null, success: null });
    try {
      const payload: Record<string, unknown> = {
        parcel_id: parcel.id,
        pickup_code: form.pickupCode.trim(),
      };
      if (form.requireIdFields) {
        payload.collector_name = form.collectorName.trim();
        payload.id_last4 = form.idLast4.trim();
      }

      const res = await fetch(`${API_BASE}/parcel-pickup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 422) {
          patchForm(parcel.id, {
            requireIdFields: true,
            busy: false,
            error: "High-value parcel requires collector name and last 4 of ID.",
          });
          return;
        }

        if (res.status === 409) {
          patchForm(parcel.id, {
            busy: false,
            error: "Parcel is no longer in arrived status — refreshing list.",
          });
          // M2: auto-resync on 409 conflict instead of requiring manual refresh
          loadParcels();
          return;
        }

        const info = await getErrorInfoFromResponse(res, "Unable to confirm pickup right now.");
        if (info.authz) {
          setAuthzState(info.authz);
        }
        patchForm(parcel.id, { busy: false, error: info.message });
        return;
      }

      patchForm(parcel.id, {
        busy: false,
        error: null,
        success: "Pickup confirmed.",
        pickupCode: "",
      });

      // M2: authoritative re-fetch instead of local-only row removal,
      // so concurrent pickups by other staff are reflected immediately.
      loadParcels();
    } catch (err: unknown) {
      patchForm(parcel.id, {
        busy: false,
        error: toUserSafeMessageFromUnknown(err, "Unable to confirm pickup right now."),
      });
    }
  }, [freshnessTtlMs, getForm, loadParcels, patchForm, snapshotAt, token]);

  const handleAuthzAction = useCallback(() => {
    if (!authzState) return;
    if (authzState.status === 401) {
      sessionStorage.removeItem("ops_session");
      window.location.reload();
      return;
    }
    window.location.href = "/staff-hub";
  }, [authzState]);

  return (
    <main className="min-h-screen bg-stone-950 text-white p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Parcel Pickup</h1>
            <p className="text-xs text-stone-400">Canonical handoff surface — confirm only when backend status is arrived and snapshot is fresh.</p>
          </div>
          <button
            type="button"
            onClick={loadParcels}
            className="px-3 py-2 rounded-lg border border-stone-700 text-sm text-stone-300 hover:border-stone-500"
          >
            Refresh
          </button>
        </header>

        {authzState && (
          <AuthzErrorStateCard state={authzState} onAction={handleAuthzAction} />
        )}

        {error && !authzState && (
          <p role="alert" className="rounded-lg bg-red-950/40 border border-red-500/30 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="text-xs text-stone-500">
          Snapshot: {snapshotAt ? new Date(snapshotAt).toLocaleTimeString() : "—"} · {statusIsFresh ? "fresh" : "stale"}
        </div>

        {loading ? (
          <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-6 text-stone-400">Loading arrived parcels…</div>
        ) : parcels.length === 0 ? (
          <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-6 text-stone-400">No parcels currently awaiting pickup.</div>
        ) : (
          <div className="space-y-3">
            {parcels.map((parcel) => {
              const form = getForm(parcel.id);
              const gateReason = pickupGateReason(parcel.status, snapshotAt, Date.now(), freshnessTtlMs);
              const canConfirm = !gateReason && !form.busy;

              return (
                <section key={parcel.id} className="rounded-xl border border-stone-800 bg-stone-900/40 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{parcel.tracking_number || "No tracking"}</div>
                      <div className="text-xs text-stone-400">{parcel.recipient_name || "Unknown recipient"} · Unit {parcel.unit_number || "—"}</div>
                    </div>
                    <span className="text-xs uppercase px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {parcel.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.pickupCode}
                      onChange={(e) => patchForm(parcel.id, { pickupCode: e.target.value.replace(/\D/g, "") })}
                      placeholder="Pickup code"
                      className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm"
                    />
                    {form.requireIdFields && (
                      <>
                        <input
                          type="text"
                          value={form.collectorName}
                          onChange={(e) => patchForm(parcel.id, { collectorName: e.target.value })}
                          placeholder="Collector name"
                          className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          value={form.idLast4}
                          onChange={(e) => patchForm(parcel.id, { idLast4: e.target.value.replace(/\D/g, "") })}
                          placeholder="ID last 4"
                          className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm"
                        />
                      </>
                    )}
                  </div>

                  {gateReason && (
                    <p className="text-xs text-amber-300">{gateReason}</p>
                  )}
                  {form.error && (
                    <p className="text-xs text-red-300">{form.error}</p>
                  )}
                  {form.success && (
                    <p className="text-xs text-emerald-300">{form.success}</p>
                  )}

                  <button
                    type="button"
                    disabled={!canConfirm}
                    onClick={() => handleConfirmPickup(parcel)}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
                  >
                    {form.busy ? "Confirming…" : "Confirm Pickup"}
                  </button>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
