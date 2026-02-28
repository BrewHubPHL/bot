export default async (request, context) => {
  const url = new URL(request.url);
  
  // 🚪 Protect API, admin, and staff-only operational routes.
  // Leaves the public site open for suppliers in CR/PA to see your address/phone.
  const isSensitivePath = 
    url.pathname.startsWith("/api/") || 
    url.pathname.startsWith("/.netlify/functions/") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/kds") ||
    url.pathname.startsWith("/pos") ||
    url.pathname.startsWith("/scanner") ||
    url.pathname.startsWith("/manager") ||
    url.pathname.startsWith("/staff-hub");

  if (!isSensitivePath) return;

  // 🌍 The BrewHub Business Corridor
  const allowedCountries = ["US", "CR", "PA"];
  const countryCode = context.geo?.country?.code;

  if (countryCode && !allowedCountries.includes(countryCode)) {
    console.log(`[Blocked] Access attempt from ${countryCode} to ${url.pathname}`);
    return new Response("Unauthorized Region", { status: 403 });
  }

  // 🔒 Bonus: Add Security Headers to all API responses
  const response = await context.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  
  return response;
};

export const config = { path: "/*" };