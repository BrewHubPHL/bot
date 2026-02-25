const DEFAULT_TTL_MS = 60_000;

export function isFreshParcelSnapshot(
  snapshotAtIso: string | null | undefined,
  nowMs = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): boolean {
  if (!snapshotAtIso) return false;
  const parsed = Date.parse(snapshotAtIso);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed <= ttlMs;
}

export function canConfirmParcelPickup(
  status: string,
  snapshotAtIso: string | null | undefined,
  nowMs = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): boolean {
  return status === "arrived" && isFreshParcelSnapshot(snapshotAtIso, nowMs, ttlMs);
}

export function pickupGateReason(
  status: string,
  snapshotAtIso: string | null | undefined,
  nowMs = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): string | null {
  if (status !== "arrived") return "Parcel is no longer in arrived status.";
  if (!isFreshParcelSnapshot(snapshotAtIso, nowMs, ttlMs)) return "Parcel status snapshot is stale. Refresh before confirming pickup.";
  return null;
}

export const PARCEL_PICKUP_FRESHNESS_TTL_MS = DEFAULT_TTL_MS;
