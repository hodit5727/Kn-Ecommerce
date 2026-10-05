/**
 * Shared HTTP helper for calling the Express backend.
 *
 * Security notes:
 * - Session travels in an HttpOnly cookie (`credentials: 'include'`); the
 *   frontend never stores tokens, user ids, or roles in
 *   localStorage/sessionStorage.
 * - No secrets live here — only the public API base URL from env config.
 * - Errors are always surfaced: this helper never swallows a failure.
 */
import { apiConfig } from './config';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ApiRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON string for normal calls; raw bytes (ArrayBuffer) for file uploads
   *  where the caller sets an explicit Content-Type (e.g. application/octet-stream). */
  body?: BodyInit;
  /** Merged over the default JSON content type — lets upload calls override it. */
  headers?: Record<string, string>;
}

function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  const errorField = record.error;
  if (typeof errorField === 'string') return errorField;
  if (errorField && typeof errorField === 'object') {
    const message = (errorField as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  if (typeof record.message === 'string') return record.message;

  return null;
}

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${apiConfig.apiBaseUrl}${path}`, {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      credentials: 'include',
      body: init.body,
    });
  } catch {
    // Network-level failure (backend not running / unreachable).
    throw new ApiError(
      'Unable to reach the server. Please check your connection and try again.',
      0,
    );
  }

  let data: unknown = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      // Non-JSON body. For successful responses that is unexpected; for error
      // responses (e.g. an HTML error page) fall through to the status check.
      if (res.ok) {
        throw new ApiError('The server returned an unexpected response.', res.status);
      }
    }
  }

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('kshop:session-expired', {
          detail: {
            url: path,
            pathname: window.location.pathname,
          },
        })
      );
    }
    throw new ApiError(
      extractMessage(data) ?? `Request failed with status ${res.status}.`,
      res.status,
    );
  }

  if (data === null) {
    throw new ApiError('The server returned an unexpected response.', res.status);
  }

  return data as T;
}
