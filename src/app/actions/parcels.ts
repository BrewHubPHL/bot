"use server";

import { revalidatePath } from "next/cache";

/**
 * Server actions for parcel cache invalidation.
 *
 * The actual mutations happen in Netlify functions (parcel-check-in.js,
 * parcel-pickup.js). After mutation, the client calls these actions to
 * bust the Next.js Full Route Cache and Router Cache so residents see
 * up-to-date parcel status immediately.
 */

/** Invalidate all parcel-related cached pages after a check-in */
export async function invalidateParcelCache() {
  revalidatePath("/portal");
  revalidatePath("/parcels");
}

/** Alias specifically for check-in flows */
export async function onParcelCheckedIn() {
  revalidatePath("/portal");
  revalidatePath("/parcels");
}

/** Alias specifically for pickup flows */
export async function onParcelPickedUp() {
  revalidatePath("/portal");
  revalidatePath("/parcels");
}
