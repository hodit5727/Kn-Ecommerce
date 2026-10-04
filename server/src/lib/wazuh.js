/**
 * Wazuh Security Information & Event Management (SIEM) Surveillance Module.
 *
 * Gathers system hardware/network metrics (MAC address, Host IP, OS, hostname)
 * and formats structured security alerts compliant with Wazuh / OSSEC HIDS JSON schemas.
 * Appends all alerts to `server/logs/wazuh_alerts.jsonl` for continuous log ingestion.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(HERE, '..', '..', 'logs');
const WAZUH_LOG_FILE = path.join(LOGS_DIR, 'wazuh_alerts.jsonl');

// Ensure server/logs directory exists
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
} catch {
  // best-effort
}

/**
 * Gathers server machine hardware, network interfaces, and MAC addresses.
 */
export function getSystemInfo() {
  const interfaces = os.networkInterfaces();
  let primaryMac = '00:00:00:00:00:00';
  let primaryIp = '127.0.0.1';

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === 'IPv4') {
        primaryIp = addr.address;
        if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
          primaryMac = addr.mac.toUpperCase();
        }
        break;
      }
    }
  }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    mac: primaryMac,
    ip: primaryIp,
    uptimeSeconds: Math.round(os.uptime()),
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
  };
}

/**
 * Record a security event in standard Wazuh HIDS / SIEM JSON format.
 */
export function recordWazuhSecurityEvent({
  eventName,
  alertReason,
  level = 8,
  ruleId = 100100,
  mitre = ['T1078'],
  req = null,
  user = null,
  details = {},
}) {
  try {
    const sys = getSystemInfo();
    const eventId = `${Date.now()}.${crypto.randomInt(100000, 999999)}`;
    const timestamp = new Date().toISOString();

    const clientIp =
      req?.ip ||
      req?.headers?.['x-forwarded-for'] ||
      req?.socket?.remoteAddress ||
      '127.0.0.1';
    const clientUserAgent = req?.headers?.['user-agent'] || 'Unknown';
    const requestUrl = req ? `${req.method} ${req.originalUrl || req.url}` : 'INTERNAL';

    const wazuhEvent = {
      timestamp,
      id: eventId,
      alert_reason: alertReason || eventName || 'SECURITY_ALERT',
      rule: {
        id: ruleId,
        level,
        description: `K-SHOP Security Event: ${alertReason || eventName}`,
        groups: ['kshop', 'ecommerce', 'security_audit'],
        mitre,
      },
      agent: {
        id: 'kshop-server-agent-01',
        name: sys.hostname,
        ip: sys.ip,
        mac: sys.mac,
      },
      manager: {
        name: 'kshop-wazuh-manager',
      },
      data: {
        srcip: clientIp,
        user_agent: clientUserAgent,
        request_endpoint: requestUrl,
        user: {
          id: user?.id || req?.auth?.profile?.id || req?.user?.id || null,
          email: user?.email || req?.auth?.profile?.email || req?.user?.email || null,
          role: user?.role || req?.auth?.profile?.role || req?.user?.role || 'ANONYMOUS',
        },
        system_diagnostics: {
          hostname: sys.hostname,
          platform: sys.platform,
          host_ip: sys.ip,
          host_mac: sys.mac,
        },
        payload: details,
      },
      full_log: `[WAZUH ALERT] ${alertReason} on ${requestUrl} by ${clientIp} (MAC: ${sys.mac})`,
    };

    // Append JSON line to wazuh_alerts.jsonl
    const line = JSON.stringify(wazuhEvent) + '\n';
    fs.appendFile(WAZUH_LOG_FILE, line, 'utf8', () => {});

    // Also surface in console
    // eslint-disable-next-line no-console
    console.log(`[WAZUH-ALERT] ${wazuhEvent.full_log}`);

    return wazuhEvent;
  } catch (err) {
    // Fail-safe — never crash business logic
    // eslint-disable-next-line no-console
    console.error('[wazuh] Failed to write security event:', err?.message || err);
    return null;
  }
}
