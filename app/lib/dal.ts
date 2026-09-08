import "server-only";
import { cache } from "react";
import { readSession, type SessionPayload } from "./session";

/**
 * Data Access Layer entry point. Deliberately does NOT redirect — callers
 * differ (a page redirects to /login, an API route returns 401 JSON), so
 * that decision stays with the caller. Memoized per request with React's
 * cache() so multiple call sites in one render don't re-verify repeatedly.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  return readSession();
});
