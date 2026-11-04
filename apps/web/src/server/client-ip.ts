// apps/web/src/server/client-ip.ts
//
// Client-IP hashing helper (design "Handler pipeline" step 1).
//
//   clientIp(req: Request, env: RouteEnvPort): string
//
// Reads the configured proxy header (name from `NECRO_CLIENT_IP_HEADER`,
// default `x-real-ip`), validates its value as a strict IPv4 or IPv6 literal,
// and returns a stable 32-char lowercase hex id `sha256(ip).slice(0, 32)`.
// When the header is absent or the value is not a valid IP literal, it hashes
// the fixed string "anonymous" instead. The RAW IP is NEVER returned — only
// the truncated hash — honouring the privacy rule (R13.9).
//
// `node:net.isIP` is the literal validator: it returns 4 / 6 for valid IPv4 /
// IPv6 literals and 0 otherwise. It rejects out-of-range octets
// (`isIP("999.0.0.1") === 0`) and port suffixes (`isIP("203.0.113.7:8080")
// === 0`), which is exactly the "literal only" contract the examples require.
//
// _Requirements: R5.3, R6.1, R6.4, R13.9_

import { createHash } from "node:crypto";
import { isIP } from "node:net";

/**
 * Structural view of the env port used here: `clientIp` only reads the
 * configured header name. Defined locally to avoid a cross-task dependency on
 * the composition `RouteEnvPort` (task 24); any port exposing `get` satisfies
 * it.
 */
export interface IpEnv {
  get(key: string): string | undefined;
}

const DEFAULT_HEADER = "x-real-ip";
const ANONYMOUS = "anonymous";

/** sha256 of `value`, lowercase hex, truncated to 32 characters. */
function hash32(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Derive a stable, privacy-preserving client id from the request's configured
 * IP header. Returns the hash of the validated IP literal, or the hash of
 * "anonymous" when the header is missing or not a valid IPv4/IPv6 literal.
 * Never returns the raw IP.
 */
export function clientIp(req: Request, env: IpEnv): string {
  const headerName = env.get("NECRO_CLIENT_IP_HEADER") ?? DEFAULT_HEADER;
  const raw = req.headers.get(headerName);
  if (raw !== null && isIP(raw) !== 0) {
    return hash32(raw);
  }
  return hash32(ANONYMOUS);
}
