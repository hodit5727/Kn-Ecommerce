/**
 * Client-Side Error Surveillance & Incident Telemetry (Sentry-Style).
 *
 * Captures unhandled browser exceptions, runtime errors, and failed critical
 * transactions, transmitting them to the Express surveillance backend which
 * dispatches immediate high-priority alerts to the platform administrator.
 */

const sentSignatures = new Set<string>();

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const name = err.name || 'ClientRuntimeError';
    const message = err.message || 'Unknown browser error';
    const stack = err.stack || '';

    const signature = `${name}:${message}:${window.location.pathname}`;
    if (sentSignatures.has(signature)) return; // Deduplicate in same browser session
    sentSignatures.add(signature);

    // Send error event to backend telemetry endpoint
    fetch('/api/v1/telemetry/error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        message,
        stack,
        url: window.location.href,
        context,
      }),
      keepalive: true,
    }).catch(() => {
      // Telemetry failures are quietly dropped to never cause cascading client errors
    });
  } catch {
    // Fail-safe
  }
}

let initialized = false;

export function initClientTelemetry(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Unhandled synchronous script errors
  window.addEventListener('error', (event) => {
    // Ignore third-party browser extension noise
    if (event.filename && !event.filename.includes(window.location.origin)) {
      return;
    }
    captureException(event.error || new Error(event.message));
  });

  // Unhandled async promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    captureException(event.reason);
  });
}
