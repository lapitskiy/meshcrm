export function getGatewayBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (typeof window === "undefined") {
    return fromEnv || "http://localhost:8080";
  }
  // Prefer same-origin proxy to avoid cross-port fetch issues in browser.
  if (!fromEnv || fromEnv.includes("localhost") || fromEnv.includes("127.0.0.1")) {
    return "/api";
  }
  return fromEnv;
}

