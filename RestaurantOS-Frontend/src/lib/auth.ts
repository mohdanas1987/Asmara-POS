/**
 * Frontend RBAC-aware navigation (new execution plan, Phase 10 gap: "frontend adapts").
 * The backend already embeds the user's role in the signed JWT (routes/auth.js) and enforces
 * every permission server-side via requirePermission -- this file exists ONLY to let the UI
 * hide nav items a role can't use, as a UX convenience. It is never the source of truth:
 * decoding here does not verify the JWT signature, and a request for a hidden route would
 * still be rejected server-side exactly as before. Never gate anything security-sensitive on
 * this alone.
 */
import { getToken } from './api';

interface DecodedTokenPayload {
  user?: { id?: number; tenant_id?: number; role?: string };
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return decodeURIComponent(
      window
        .atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  }
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/** Returns the role embedded in the current session's JWT, or null if absent/unreadable. */
export function getCurrentRole(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const [, payloadSegment] = token.split('.');
    if (!payloadSegment) return null;
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as DecodedTokenPayload;
    return payload.user?.role ?? null;
  } catch {
    return null;
  }
}
