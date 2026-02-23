import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "crypto";

/**
 * POST /api/revalidate
 *
 * Called by Netlify functions (parcel-check-in, parcel-pickup, etc.)
 * after a mutation to bust the Next.js Full Route Cache and Router Cache.
 *
 * Requires `x-brewhub-secret` header matching INTERNAL_SYNC_SECRET.
 *
 * Body: { paths?: string[] }
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-brewhub-secret") || "";
  const envSecret = process.env.INTERNAL_SYNC_SECRET || "";

  if (!secret || !envSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Constant-time comparison
  try {
    const a = Buffer.from(secret);
    const b = Buffer.from(envSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { paths?: string[] };

    const revalidated: string[] = [];

    if (Array.isArray(body.paths)) {
      for (const p of body.paths) {
        if (typeof p === "string" && p.startsWith("/")) {
          revalidatePath(p);
          revalidated.push(`path:${p}`);
        }
      }
    }

    return NextResponse.json({ ok: true, revalidated });
  } catch (err) {
    console.error("[REVALIDATE] Error:", (err as Error)?.message);
    return NextResponse.json({ error: "Revalidation failed" }, { status: 500 });
  }
}
