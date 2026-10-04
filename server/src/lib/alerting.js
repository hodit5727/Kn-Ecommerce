/**
 * Sentry-Style Incident Surveillance & Urgent Alerting Subsystem.
 *
 * Capabilities:
 * - Traces all unhandled 500 / critical exceptions with full request context.
 * - Sentry-compatible event formatting (eventId, fingerprint, stack frames,
 *   request metadata, user identity, breadcrumbs).
 * - Automatic URGENT email alerts dispatched directly to the admin email
 *   (ADMIN_BOOTSTRAP_EMAIL) via server SMTP.
 * - Anti-flood deduplication / cooldown: alerts instantly on the first occurrence,
 *   then throttles identical signatures (5-min window) so error loops cannot
 *   bombard the admin's inbox while still tracking event counts.
 * - Diagnostic ring buffer for administrative inspection.
 */
import crypto from 'node:crypto';
import { sendAdminUrgentAlertEmail } from './mail.js';
import { recordWazuhSecurityEvent } from './wazuh.js';

const MAX_INCIDENTS = 100;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes deduplication cooldown

const incidentBuffer = [];
const incidentCooldowns = new Map(); // fingerprint -> { lastSentAt, count }

function computeFingerprint(err, req) {
  const name = String(err?.name || 'Error');
  const message = String(err?.message || 'unknown');
  const firstFrame = String(err?.stack || '').split('\n')[1] || '';
  const path = String(req?.baseUrl || '') + String(req?.path || req?.url || '');
  const raw = `${name}|${message}|${firstFrame.trim()}|${path}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function sanitizeHeaders(headers = {}) {
  const safe = {};
  const sensitiveKeys = new Set(['cookie', 'authorization', 'x-api-key', 'set-cookie', 'password']);
  for (const [k, v] of Object.entries(headers)) {
    if (sensitiveKeys.has(k.toLowerCase())) {
      safe[k] = '[REDACTED]';
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

export function recordIncident({ env, req, err, level = 'error', source = 'backend' }) {
  const eventId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const fingerprint = computeFingerprint(err, req);

  const errorName = String(err?.name || 'InternalServerError');
  const errorMessage = String(err?.message || 'An unexpected error occurred');
  const stackTrace = String(err?.stack || '');
  const requestMethod = req ? String(req.method || 'GET').toUpperCase() : 'INTERNAL';
  const requestUrl = req ? String(req.originalUrl || req.url || '') : 'N/A';
  const clientIp = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1';
  const userAgent = req?.headers?.['user-agent'] || 'Unknown';
  const userId = req?.auth?.user?.id || req?.user?.id || null;
  const userEmail = req?.auth?.user?.email || req?.user?.email || null;
  const userRole = req?.auth?.role || req?.user?.role || null;

  const incident = {
    eventId,
    fingerprint,
    timestamp,
    level,
    source,
    error: {
      name: errorName,
      message: errorMessage,
      stack: stackTrace,
    },
    request: {
      method: requestMethod,
      url: requestUrl,
      ip: clientIp,
      userAgent,
      headers: req ? sanitizeHeaders(req.headers) : {},
      query: req?.query || {},
    },
    user: {
      id: userId,
      email: userEmail,
      role: userRole,
    },
    system: {
      nodeVersion: process.version,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage(),
    },
  };

  // Keep in circular diagnostic buffer
  incidentBuffer.unshift(incident);
  if (incidentBuffer.length > MAX_INCIDENTS) {
    incidentBuffer.pop();
  }

  // Record in Wazuh SIEM format with IP, MAC, alert reason, and system diagnostics
  recordWazuhSecurityEvent({
    eventName: errorName,
    alertReason: `SYSTEM_INCIDENT_${errorName.toUpperCase()}`,
    level: level === 'fatal' ? 12 : 9,
    ruleId: level === 'fatal' ? 100500 : 100501,
    mitre: ['T1499', 'T1190'],
    req,
    user: { id: userId, email: userEmail, role: userRole },
    details: {
      errorMessage,
      stack: stackTrace ? stackTrace.slice(0, 1000) : '',
      fingerprint,
      eventId,
    },
  });

  // Deduplication check for email alert
  const now = Date.now();
  const entry = incidentCooldowns.get(fingerprint);
  let shouldSendEmail = false;

  if (!entry || now - entry.lastSentAt > COOLDOWN_MS) {
    shouldSendEmail = true;
    incidentCooldowns.set(fingerprint, { lastSentAt: now, count: 1 });
  } else {
    entry.count += 1;
    // Log throttling notice
    // eslint-disable-next-line no-console
    console.warn(`[alerting] Incident ${fingerprint} suppressed by cooldown (occurrences: ${entry.count})`);
  }

  // Dispatch urgent alert email to admin asynchronously
  if (shouldSendEmail && env) {
    sendAdminUrgentAlertEmail(env, {
      eventId,
      errorName,
      errorMessage,
      stackTrace,
      requestMethod,
      requestUrl,
      clientIp,
      userAgent,
      userId: userId ? `${userId} (${userEmail || userRole || 'user'})` : 'Unauthenticated / Guest',
      timestamp,
    }).catch((emailErr) => {
      // eslint-disable-next-line no-console
      console.error('[alerting] Failed to dispatch urgent admin alert:', emailErr?.message || emailErr);
    });
  }

  return incident;
}

export function getRecentIncidents(limit = 50) {
  return incidentBuffer.slice(0, Math.max(1, Math.min(limit, MAX_INCIDENTS)));
}
