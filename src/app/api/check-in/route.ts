import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rateLimit";

/**
 * POST /api/check-in
 *
 * Thin App Router proxy for parcel check-in that enforces rate limiting
 * before forwarding to the Netlify function. Prevents barcode-scanner
 * spam and replay attacks from overwhelming the backend.
 *
 * Rate limit: 10 requests per 60 seconds per IP.
 */

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  if (!limiter.check(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // Forward to Netlify function with original headers
  const authHeader = request.headers.get("authorization") || "";
  const csrfHeader = request.headers.get("x-brewhub-action") || "";

  const body = await request.text();

  const upstream = await fetch(
    `${process.env.SITE_URL || ""}/.netlify/functions/parcel-check-in`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "X-BrewHub-Action": csrfHeader,
      },
      body,
    }
  );

  const data = await upstream.text();

  return new NextResponse(data, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
      "X-RateLimit-Remaining": String(limiter.remaining(ip)),
    },
  });
}
