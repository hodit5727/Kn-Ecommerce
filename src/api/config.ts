/**
 * Public API configuration (frontend).
 *
 * Security notes:
 * - Only PUBLIC build-time values live here (VITE_* vars are exposed to the
 *   browser by design). No secrets, tokens, or privileged URLs — ever.
 * - The default `/api/v1` is a same-origin path (proxied to Express in dev),
 *   NOT a fallback backend: if the backend is unreachable every request still
 *   fails loudly via ApiError and callers render error states.
 * - Override with VITE_API_BASE_URL at build time (see .env.example).
 */

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const apiConfig = {
  /** Base path prepended to every backend request by apiRequest(). */
  apiBaseUrl: configuredBaseUrl && configuredBaseUrl.trim() !== ''
    ? configuredBaseUrl.replace(/\/+$/, '')
    : '/api/v1',
};
