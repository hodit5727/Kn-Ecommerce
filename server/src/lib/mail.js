/**
 * Transactional email sender (SERVER-side SMTP).
 *
 * Used by the forgot-PIN flow (spec §6 "Send a professional email") where
 * Supabase Auth's built-in templates don't fit (we send a 6-digit PIN-reset
 * code, not a magic link). Renders the branded templates in
 * email/templates/ and sends through the SMTP server configured in the
 * environment (Gmail app password in this deployment).
 *
 * SMTP is OPTIONAL at the env level (env.SMTP is null when SMTP_HOST is
 * unset). Sending then throws a clear error — the caller decides how to
 * surface it (never silently swallowed; see §2.7 / §5-80).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'email',
  'templates',
);

let transport = null; // lazily created — no SMTP work at import time

function getTransport(env) {
  if (!env.SMTP || !env.SMTP.host) {
    throw new Error(
      'SMTP is not configured (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM) — cannot send the PIN reset email.',
    );
  }
  if (!transport) {
    transport = nodemailer.createTransport({
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      host: env.SMTP.host,
      port: env.SMTP.port,
      secure: env.SMTP.port === 465,
      auth:
        env.SMTP.user && env.SMTP.pass
          ? { user: env.SMTP.user, pass: env.SMTP.pass }
          : undefined,
    });
  }
  return transport;
}

/** Render a template from email/templates/, replacing {{key}} placeholders. */
export async function renderTemplate(name, vars) {
  const raw = await readFile(path.join(TEMPLATE_DIR, name), 'utf8');
  return Object.entries(vars).reduce(
    (html, [key, value]) => html.split(`{{${key}}}`).join(String(value ?? '')),
    raw,
  );
}

/**
 * Send the branded PIN-reset email (template pin-reset.html).
 * @throws on setup/send failure — the caller must handle loudly.
 */
export async function sendPinResetEmail(env, { to, code, validMinutes }) {
  const html = await renderTemplate('pin-reset.html', {
    reset_code: code,
    valid_minutes: validMinutes,
    recipient_email: to,
    current_year: new Date().getFullYear(),
  });
  const t = getTransport(env);
  const fromAddress = env.SMTP.from || env.SMTP.user;
  return t.sendMail({
    from: {
      name: env.SMTP.fromName || 'K-Shop',
      address: fromAddress,
    },
    to,
    subject: 'Reset your K-Shop PIN',
    html,
    text: `Your K-Shop PIN reset code is ${code}. It expires in ${validMinutes} minutes.`,
  });
}

/**
 * Send seller verification submission confirmation email.
 * Non-blocking: failures are logged, never thrown to break the user's flow.
 */
export async function sendSellerSubmissionEmail(env, { to, fullName, storeName }) {
  try {
    if (!env?.SMTP || !env.SMTP.host) {
      console.warn('[mail] SMTP not configured; skipping seller submission email to', to);
      return null;
    }
    const html = await renderTemplate('seller-verification-submitted.html', {
      recipient_name: fullName || 'Artisan',
      store_name: storeName || 'your store',
      recipient_email: to,
      current_year: new Date().getFullYear(),
    });
    const t = getTransport(env);
    const fromAddress = env.SMTP.from || env.SMTP.user;
    return await t.sendMail({
      from: {
        name: env.SMTP.fromName || 'K-Shop',
        address: fromAddress,
      },
      to,
      subject: 'K-SHOP Seller Verification Submitted',
      html,
      text: `Hello ${fullName || 'Artisan'}, your seller verification for ${storeName || 'your store'} has been submitted and is under review.`,
    });
  } catch (err) {
    console.warn('[mail] Failed to send seller submission email to', to, ':', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Send seller accreditation approval email with their permanent Seller ID.
 * Non-blocking: failures are logged, never thrown.
 */
export async function sendSellerApprovedEmail(env, { to, fullName, storeName, sellerId, dashboardUrl }) {
  try {
    if (!env?.SMTP || !env.SMTP.host) {
      console.warn('[mail] SMTP not configured; skipping seller approved email to', to);
      return null;
    }
    const html = await renderTemplate('seller-accreditation-approved.html', {
      recipient_name: fullName || 'Artisan',
      store_name: storeName || 'your store',
      seller_id: sellerId,
      dashboard_url: dashboardUrl || `${String(env.APP_URL || '').replace(/\/+$/, '')}/seller`,
      recipient_email: to,
      current_year: new Date().getFullYear(),
    });
    const t = getTransport(env);
    const fromAddress = env.SMTP.from || env.SMTP.user;
    return await t.sendMail({
      from: {
        name: env.SMTP.fromName || 'K-Shop',
        address: fromAddress,
      },
      to,
      subject: `K-SHOP Seller Accreditation Approved — ${sellerId}`,
      html,
      text: `Congratulations ${fullName || 'Artisan'}! Your seller accreditation for ${storeName || 'your store'} has been approved. Your permanent Seller ID is ${sellerId}. Access your dashboard at ${dashboardUrl || `${String(env.APP_URL || '').replace(/\/+$/, '')}/seller`}`,
    });
  } catch (err) {
    console.warn('[mail] Failed to send seller approval email to', to, ':', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Send order delivered confirmation email to the customer.
 */
export async function sendOrderDeliveredEmail(env, { to, orderCode, customerName, totalAmount }) {
  try {
    if (!env.SMTP || !env.SMTP.host) {
      console.log(`[mail] Delivery confirmation queued for ${to} (${orderCode}) — SMTP not configured.`);
      return null;
    }
    const t = getTransport(env);
    const fromAddress = env.SMTP.from || env.SMTP.user;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #FFF9F2; color: #171717; border-radius: 20px; border: 1px solid #E8DCCF;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #8F0025; font-size: 24px; margin: 0; font-family: serif; letter-spacing: 1px;">K-SHOP</h1>
          <p style="font-size: 11px; text-transform: uppercase; color: #B8860B; margin: 4px 0 0; font-weight: bold; letter-spacing: 2px;">Campus White-Glove Handover</p>
        </div>
        <div style="background: #ffffff; border-radius: 16px; padding: 24px; border: 1px solid #E8DCCF;">
          <h2 style="font-size: 18px; margin: 0 0 12px; color: #171717;">Order Delivered Successfully</h2>
          <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px; color: #4B4540;">
            Hello <strong>${customerName || 'Valued Patron'}</strong>,<br/>
            Your campus order <strong>${orderCode}</strong> has been successfully handed over by the campus delivery personnel and the Cash on Delivery payment of <strong>₹${totalAmount}</strong> has been collected.
          </p>
          <div style="background: #F8F5F0; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 6px; font-size: 12px; color: #6B625C;"><strong>Order Reference:</strong> ${orderCode}</p>
            <p style="margin: 0 0 6px; font-size: 12px; color: #6B625C;"><strong>Delivery Status:</strong> COMPLETED & SETTLED</p>
            <p style="margin: 0; font-size: 14px; color: #8F0025; font-weight: bold;">Amount Paid: ₹${totalAmount}</p>
          </div>
          <p style="font-size: 12px; line-height: 1.5; color: #6B625C; margin: 0;">
            Thank you for shopping at K-Shop Campus. You can review your items, request exchanges or refunds anytime through your orders portal.
          </p>
        </div>
        <p style="text-align: center; font-size: 11px; color: #9E948A; margin-top: 20px;">
          K-SHOP Autonomous Campus Commerce • Support: support@kshop.ac.in
        </p>
      </div>
    `;

    return await t.sendMail({
      from: {
        name: env.SMTP.fromName || 'K-Shop Campus',
        address: fromAddress,
      },
      to,
      subject: `Order Delivered: ${orderCode} — K-SHOP Campus`,
      html,
      text: `Hello ${customerName || 'Valued Patron'}, Your campus order ${orderCode} has been successfully delivered and COD cash of ₹${totalAmount} collected. Thank you for shopping with K-SHOP!`,
    });
  } catch (err) {
    console.warn('[mail] Failed to send order delivered email to', to, ':', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Send urgent system alert email to the platform administrator.
 */
export async function sendAdminUrgentAlertEmail(env, {
  eventId,
  errorName,
  errorMessage,
  stackTrace,
  requestMethod,
  requestUrl,
  clientIp,
  userAgent,
  userId,
  timestamp,
}) {
  try {
    if (!env?.SMTP || !env.SMTP.host) {
      console.warn('[mail] SMTP not configured; skipping urgent admin error alert.');
      return null;
    }
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';
    const t = getTransport(env);
    const fromAddress = env.SMTP.from || env.SMTP.user;

    const formattedTime = new Date(timestamp || Date.now()).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px; background: #0c0a09; color: #f5f5f4; border-radius: 16px; border: 1px solid #dc2626;">
        <div style="background: linear-gradient(135deg, #7f1d1d, #450a0a); padding: 20px 24px; border-radius: 12px; margin-bottom: 20px; border-left: 6px solid #ef4444;">
          <h1 style="color: #ffffff; font-size: 20px; margin: 0 0 6px; font-weight: 700; letter-spacing: 0.5px;">
            🚨 URGENT SYSTEM ALERT: Backend Error
          </h1>
          <p style="color: #fca5a5; font-size: 13px; margin: 0; font-family: monospace;">
            INCIDENT ID: ${eventId} • ${formattedTime} (IST)
          </p>
        </div>

        <div style="background: #1c1917; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #292524;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #ef4444; font-family: monospace;">
            ${errorName}: ${errorMessage}
          </h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; color: #d6d3d1;">
            <tr>
              <td style="padding: 6px 0; font-weight: 600; width: 140px; color: #a8a29e;">Failed Endpoint:</td>
              <td style="padding: 6px 0; font-family: monospace; color: #fbbf24;"><strong>${requestMethod}</strong> ${requestUrl}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: 600; color: #a8a29e;">Client IP:</td>
              <td style="padding: 6px 0; font-family: monospace;">${clientIp || 'Unknown'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: 600; color: #a8a29e;">User Agent:</td>
              <td style="padding: 6px 0; font-size: 11px; color: #78716c;">${userAgent || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: 600; color: #a8a29e;">User Context:</td>
              <td style="padding: 6px 0; font-family: monospace;">${userId || 'Anonymous / Guest'}</td>
            </tr>
          </table>
        </div>

        <div style="background: #18181b; border-radius: 12px; padding: 16px; margin-bottom: 20px; border: 1px solid #27272a;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; display: block; margin-bottom: 8px;">
            Stack Trace Diagnostics
          </span>
          <pre style="margin: 0; font-family: Consolas, monospace; font-size: 11px; line-height: 1.5; color: #f87171; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">${stackTrace || 'No stack trace available.'}</pre>
        </div>

        <p style="font-size: 11px; color: #78716c; text-align: center; margin: 0;">
          K-SHOP Autonomous Error Surveillance • Immediate Admin Notification
        </p>
      </div>
    `;

    return await t.sendMail({
      from: {
        name: env.SMTP.fromName || 'K-Shop Sentinel',
        address: fromAddress,
      },
      to: adminEmail,
      subject: `🚨 [URGENT ALERT] K-Shop Server Error: ${errorName} on ${requestMethod} ${requestUrl}`,
      priority: 'high',
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        Importance: 'High',
      },
      html,
      text: `[URGENT ALERT] ${errorName}: ${errorMessage}\nEndpoint: ${requestMethod} ${requestUrl}\nTime: ${formattedTime}\nIncident ID: ${eventId}\n\nStack:\n${stackTrace}`,
    });
  } catch (err) {
    console.error('[alerting] Failed to dispatch urgent admin alert email:', err?.message || err);
    return null;
  }
}

/**
 * ─── ORDER LIFECYCLE EMAILS ────────────────────────────────────────────────
 */

export async function sendOrderPlacedCustomerEmail(env, { to, orderCode, customerName, totalAmount, items = [] }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const itemRows = items.map((i) => {
      const name = i.product_name || i.productName || i.name || 'Campus Product';
      const qty = i.quantity || i.qty || 1;
      const amount = Number(i.line_total || i.lineTotal || (i.price * qty)) || 0;
      return `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0ebe4; font-size: 13px;">${name} × ${qty}</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0ebe4; text-align: right; font-size: 13px; font-weight: 600;">₹${amount}</td>
      </tr>
      `;
    }).join('');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px 20px; background: #FFF9F2; color: #1c1917; border-radius: 18px; border: 1px solid #E8DCCF;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #8F0025; font-size: 22px; margin: 0; font-family: serif;">K-SHOP</h1>
          <p style="font-size: 10px; text-transform: uppercase; color: #B8860B; margin: 2px 0 0; font-weight: bold; letter-spacing: 1.5px;">Campus Order Confirmation</p>
        </div>
        <div style="background: #ffffff; border-radius: 14px; padding: 22px; border: 1px solid #E8DCCF;">
          <h2 style="font-size: 17px; margin: 0 0 10px; color: #1c1917;">Order Placed Successfully</h2>
          <p style="font-size: 13px; color: #44403c; line-height: 1.5; margin: 0 0 16px;">
            Hello <strong>${customerName}</strong>, your Cash on Delivery order <strong>${orderCode}</strong> has been received and sent to the merchant for preparation.
          </p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            ${itemRows}
            <tr>
              <td style="padding: 10px 0 0; font-weight: bold; font-size: 14px;">Total Payable on Delivery:</td>
              <td style="padding: 10px 0 0; text-align: right; font-weight: bold; font-size: 16px; color: #8F0025;">₹${totalAmount}</td>
            </tr>
          </table>
          <p style="font-size: 12px; color: #78716c; margin: 0;">Payment Method: <strong>Cash on Delivery (COD)</strong> upon white-glove courier inspection.</p>
        </div>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Order Confirmed: ${orderCode} — K-SHOP`,
      html,
      text: `Hello ${customerName}, your Cash on Delivery order ${orderCode} has been placed successfully. Total Payable: ₹${totalAmount}.`,
    });
  } catch (err) {
    console.warn('[mail] Failed customer order email:', err?.message || err);
    return null;
  }
}

export async function sendOrderPlacedAdminAlertEmail(env, { orderCode, customerName, customerEmail, customerPhone, totalAmount, storeName, itemCount }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';

    const contactStr = [customerPhone, customerEmail].filter(Boolean).join(' • ') || 'N/A';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fafaf9; border-radius: 14px; border: 1px solid #e7e5e4;">
        <h2 style="color: #8F0025; font-size: 18px; margin: 0 0 12px;">📦 New Customer Order Placed</h2>
        <p style="font-size: 13px; color: #292524; line-height: 1.5; margin: 0 0 14px;">
          Order <strong>${orderCode}</strong> was placed by <strong>${customerName}</strong> (${contactStr}) for store <strong>${storeName}</strong>.
        </p>
        <div style="background: #ffffff; padding: 14px; border-radius: 10px; border: 1px solid #e7e5e4; font-size: 12px; margin-bottom: 16px;">
          <p style="margin: 0 0 6px;"><strong>Order ID:</strong> ${orderCode}</p>
          <p style="margin: 0 0 6px;"><strong>COD Amount:</strong> ₹${totalAmount}</p>
          ${itemCount ? `<p style="margin: 0 0 6px;"><strong>Items Count:</strong> ${itemCount}</p>` : ''}
          <p style="margin: 0;"><strong>Customer Contact:</strong> ${contactStr}</p>
        </div>
        <p style="font-size: 12px; color: #78716c; margin: 0;">Access Admin Orders Governance to view details or assign dispatch personnel.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Orders', address: env.SMTP.from || env.SMTP.user },
      to: adminEmail,
      subject: `[Order Alert] New Order ${orderCode} (₹${totalAmount}) — K-SHOP`,
      html,
      text: `New Order Placed: ${orderCode}\nCustomer: ${customerName} (${contactStr})\nStore: ${storeName}\nTotal Amount: ₹${totalAmount}\nReview at /admin/orders`,
    });
  } catch (err) {
    console.warn('[mail] Failed admin order alert:', err?.message || err);
    return null;
  }
}

export async function sendOrderPlacedSellerAlertEmail(env, { to, orderCode, storeName, totalAmount }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fffbeb; border-radius: 14px; border: 1px solid #fde68a;">
        <h2 style="color: #92400e; font-size: 18px; margin: 0 0 10px;">🛍️ New Order Received for ${storeName}</h2>
        <p style="font-size: 13px; color: #451a03; line-height: 1.5; margin: 0 0 14px;">
          A customer placed order <strong>${orderCode}</strong> for your products. Value: <strong>₹${totalAmount}</strong>.
        </p>
        <p style="font-size: 12px; color: #78350f; margin: 0;">Please prepare the package for campus courier collection. Escrow funds will credit to your account balance upon delivery.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Merchant Services', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `New Order Received: ${orderCode} — ${storeName}`,
      html,
    });
  } catch (err) {
    console.warn('[mail] Failed seller order email:', err?.message || err);
    return null;
  }
}

export async function sendOrderCancelledCustomerEmail(env, { to, orderCode, customerName, reason }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fff1f2; border-radius: 14px; border: 1px solid #fecdd3;">
        <h2 style="color: #be123c; font-size: 18px; margin: 0 0 10px;">Order Cancellation Notice</h2>
        <p style="font-size: 13px; color: #4c0519; line-height: 1.5; margin: 0 0 12px;">
          Hello <strong>${customerName}</strong>, order <strong>${orderCode}</strong> has been cancelled.
        </p>
        <p style="font-size: 12px; color: #881337; margin: 0 0 8px;"><strong>Reason:</strong> ${reason || 'Customer requested'}</p>
        <p style="font-size: 11px; color: #9f1239; margin: 0;">No charges were deducted since this was a Cash on Delivery order.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Order Cancelled: ${orderCode} — K-SHOP`,
      html,
    });
  } catch (err) {
    console.warn('[mail] Failed customer cancel email:', err?.message || err);
    return null;
  }
}

export async function sendOrderCancelledAdminAlertEmail(env, { orderCode, customerName, customerEmail, customerPhone, cancelledBy, reason, totalAmount }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';
    const contactStr = [customerPhone, customerEmail].filter(Boolean).join(' • ') || 'N/A';

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fff1f2; border-radius: 14px; border: 1px solid #fecdd3;">
        <h2 style="color: #be123c; font-size: 18px; margin: 0 0 12px;">🚫 Order Cancelled Alert</h2>
        <p style="font-size: 13px; color: #4c0519; line-height: 1.5; margin: 0 0 14px;">
          Order <strong>${orderCode}</strong> was cancelled by <strong>${cancelledBy || 'Customer'}</strong>.
        </p>
        <div style="background: #ffffff; padding: 14px; border-radius: 10px; border: 1px solid #fecdd3; font-size: 12px; margin-bottom: 16px;">
          <p style="margin: 0 0 6px;"><strong>Order ID:</strong> ${orderCode}</p>
          <p style="margin: 0 0 6px;"><strong>Customer:</strong> ${customerName || 'Customer'} (${contactStr})</p>
          ${totalAmount ? `<p style="margin: 0 0 6px;"><strong>Order Value:</strong> ₹${totalAmount}</p>` : ''}
          <p style="margin: 0;"><strong>Reason:</strong> ${reason || 'N/A'}</p>
        </div>
        <p style="font-size: 12px; color: #9f1239; margin: 0;">Reserved items have been returned to active catalog inventory.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Orders', address: env.SMTP.from || env.SMTP.user },
      to: adminEmail,
      subject: `[Order Cancelled] ${orderCode} — K-SHOP`,
      html,
      text: `Order ${orderCode} by ${customerName} was cancelled by ${cancelledBy}. Reason: ${reason || 'N/A'}. Contact: ${contactStr}`,
    });
  } catch (err) {
    console.warn('[mail] Failed admin cancel alert:', err?.message || err);
    return null;
  }
}

export async function sendOrderCancelledSellerAlertEmail(env, { to, orderCode, storeName, reason }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Merchant Services', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Order Cancelled: ${orderCode} — ${storeName}`,
      text: `Hello ${storeName}, order ${orderCode} has been cancelled. Reason: ${reason || 'N/A'}. The reserved items have been returned to active inventory.`,
    });
  } catch (err) {
    console.warn('[mail] Failed seller cancel alert:', err?.message || err);
    return null;
  }
}

export async function sendOrderDeliveredAdminAlertEmail(env, { orderCode, customerName, customerEmail, customerPhone, totalAmount, storeName }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';
    const contactStr = [customerPhone, customerEmail].filter(Boolean).join(' • ') || 'N/A';

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #ecfdf5; border-radius: 14px; border: 1px solid #a7f3d0;">
        <h2 style="color: #065f46; font-size: 18px; margin: 0 0 12px;">✅ Order Delivered & Cash Collected</h2>
        <p style="font-size: 13px; color: #064e3b; line-height: 1.5; margin: 0 0 14px;">
          Order <strong>${orderCode}</strong> has been successfully handed over and Cash on Delivery collected by courier personnel.
        </p>
        <div style="background: #ffffff; padding: 14px; border-radius: 10px; border: 1px solid #a7f3d0; font-size: 12px; margin-bottom: 16px;">
          <p style="margin: 0 0 6px;"><strong>Order ID:</strong> ${orderCode}</p>
          <p style="margin: 0 0 6px;"><strong>Store:</strong> ${storeName || 'Campus Merchant'}</p>
          <p style="margin: 0 0 6px;"><strong>Customer:</strong> ${customerName || 'Customer'} (${contactStr})</p>
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: #065f46;">COD Amount Collected: ₹${totalAmount}</p>
        </div>
        <p style="font-size: 12px; color: #047857; margin: 0;">Escrow entry and merchant payout ledger have been mapped.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Delivery', address: env.SMTP.from || env.SMTP.user },
      to: adminEmail,
      subject: `[Delivered & Collected] Order ${orderCode} (₹${totalAmount}) — K-SHOP`,
      html,
      text: `Order ${orderCode} for ${storeName} was delivered to ${customerName} (${contactStr}). COD cash of ₹${totalAmount} collected and escrow mapped.`,
    });
  } catch (err) {
    console.warn('[mail] Failed admin delivery alert:', err?.message || err);
    return null;
  }
}

export async function sendOrderDeliveredSellerRevenueEmail(env, { to, orderCode, storeName, totalAmount, netAmount }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #ecfdf5; border-radius: 14px; border: 1px solid #a7f3d0;">
        <h2 style="color: #065f46; font-size: 18px; margin: 0 0 10px;">💰 Revenue Credited: ${orderCode}</h2>
        <p style="font-size: 13px; color: #064e3b; line-height: 1.5; margin: 0 0 12px;">
          Good news, <strong>${storeName}</strong>! Order <strong>${orderCode}</strong> was successfully delivered to the customer.
        </p>
        <div style="background: #ffffff; padding: 14px; border-radius: 10px; border: 1px solid #a7f3d0; margin-bottom: 14px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: #047857;">Order Total: ₹${totalAmount}</p>
          <p style="margin: 0; font-size: 15px; font-weight: bold; color: #065f46;">Net Revenue Credited: ₹${netAmount}</p>
        </div>
        <p style="font-size: 12px; color: #047857; margin: 0;">Check your Seller Revenue Dashboard to inspect your updated balance and settlement payout schedule.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Settlements', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Revenue Update: Order ${orderCode} Delivered — ${storeName}`,
      html,
    });
  } catch (err) {
    console.warn('[mail] Failed seller revenue email:', err?.message || err);
    return null;
  }
}

/**
 * ─── REFUND & RETURN EMAILS ────────────────────────────────────────────────
 */

export async function sendRefundRequestedCustomerEmail(env, { to, customerName, orderCode, refundAmount, reason }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px 20px; background: #FFF9F2; color: #1c1917; border-radius: 18px; border: 1px solid #E8DCCF;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #8F0025; font-size: 22px; margin: 0; font-family: serif;">K-SHOP</h1>
          <p style="font-size: 10px; text-transform: uppercase; color: #B8860B; margin: 2px 0 0; font-weight: bold; letter-spacing: 1.5px;">Return & Refund Portal</p>
        </div>
        <div style="background: #ffffff; border-radius: 14px; padding: 22px; border: 1px solid #E8DCCF;">
          <h2 style="font-size: 17px; margin: 0 0 10px; color: #1c1917;">Return Request Received</h2>
          <p style="font-size: 13px; color: #44403c; line-height: 1.5; margin: 0 0 16px;">
            Hello <strong>${customerName || 'Valued Patron'}</strong>, your return/refund claim for order <strong>${orderCode}</strong> has been submitted and is currently being reviewed by our campus quality desk.
          </p>
          <div style="background: #F8F5F0; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 6px; font-size: 12px; color: #6B625C;"><strong>Order Reference:</strong> ${orderCode}</p>
            <p style="margin: 0 0 6px; font-size: 12px; color: #6B625C;"><strong>Estimated Refund:</strong> ₹${refundAmount}</p>
            <p style="margin: 0; font-size: 12px; color: #6B625C;"><strong>Reason:</strong> ${reason || 'Customer Return'}</p>
          </div>
          <p style="font-size: 12px; line-height: 1.5; color: #78716c; margin: 0;">
            A campus representative will coordinate item inspection and pickup. Once approved, the refund will be credited to your account or settled in cash as per campus guidelines.
          </p>
        </div>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Support', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Return Request Received: ${orderCode} — K-SHOP`,
      html,
      text: `Hello ${customerName || 'Valued Patron'}, your return request for order ${orderCode} (Refund: ₹${refundAmount}) has been received and is under review. Reason: ${reason || 'N/A'}.`,
    });
  } catch (err) {
    console.warn('[mail] Failed customer refund request email:', err?.message || err);
    return null;
  }
}

export async function sendRefundRequestedAdminAlertEmail(env, { orderCode, customerName, customerEmail, customerPhone, refundAmount, reason }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';
    const contactStr = [customerPhone, customerEmail].filter(Boolean).join(' • ') || 'N/A';

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fffbeb; border-radius: 14px; border: 1px solid #fde68a;">
        <h2 style="color: #92400e; font-size: 18px; margin: 0 0 12px;">⚠️ New Refund / Return Claim Requested</h2>
        <p style="font-size: 13px; color: #451a03; line-height: 1.5; margin: 0 0 14px;">
          Customer <strong>${customerName}</strong> has filed a return/refund request for order <strong>${orderCode}</strong>.
        </p>
        <div style="background: #ffffff; padding: 14px; border-radius: 10px; border: 1px solid #fde68a; font-size: 12px; margin-bottom: 16px;">
          <p style="margin: 0 0 6px;"><strong>Order ID:</strong> ${orderCode}</p>
          <p style="margin: 0 0 6px;"><strong>Claim Amount:</strong> ₹${refundAmount}</p>
          <p style="margin: 0 0 6px;"><strong>Customer:</strong> ${customerName} (${contactStr})</p>
          <p style="margin: 0;"><strong>Reason:</strong> ${reason || 'N/A'}</p>
        </div>
        <p style="font-size: 12px; color: #78350f; margin: 0;">Adjudicate, approve, or reject this claim via Admin Refunds Governance at /admin/refunds.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Refunds', address: env.SMTP.from || env.SMTP.user },
      to: adminEmail,
      subject: `[Refund Requested] Order ${orderCode} (₹${refundAmount}) — K-SHOP`,
      html,
      text: `Customer ${customerName} has requested a refund of ₹${refundAmount} for order ${orderCode}. Contact: ${contactStr}. Reason: ${reason}. Please adjudicate at /admin/refunds.`,
    });
  } catch (err) {
    console.warn('[mail] Failed admin refund alert:', err?.message || err);
    return null;
  }
}

export async function sendRefundStatusCustomerEmail(env, { to, orderCode, customerName, status, refundAmount, notes }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const isApproved = status === 'APPROVED' || status === 'COMPLETED';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: ${isApproved ? '#f0fdf4' : '#fff1f2'}; border-radius: 14px; border: 1px solid ${isApproved ? '#bbf7d0' : '#fecdd3'};">
        <h2 style="color: ${isApproved ? '#15803d' : '#be123c'}; font-size: 18px; margin: 0 0 10px;">Refund Status: ${status}</h2>
        <p style="font-size: 13px; color: #1c1917; line-height: 1.5; margin: 0 0 12px;">
          Hello <strong>${customerName}</strong>, your refund request for order <strong>${orderCode}</strong> (₹${refundAmount}) has been updated to: <strong>${status}</strong>.
        </p>
        ${notes ? `<p style="font-size: 12px; color: #57534e; margin: 0 0 8px;"><strong>Admin Note:</strong> ${notes}</p>` : ''}
        <p style="font-size: 11px; color: #78716c; margin: 0;">For campus assistance, reach support at support@kshop.ac.in.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Support', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Refund Status Update: ${orderCode} — ${status}`,
      html,
    });
  } catch (err) {
    console.warn('[mail] Failed customer refund email:', err?.message || err);
    return null;
  }
}

/**
 * ─── SELLER & PRODUCT VERIFICATION EMAILS ──────────────────────────────────
 */

export async function sendSellerApplicationAdminAlertEmail(env, { applicantName, storeName, email, mobile, category, businessType }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fafaf9; border-radius: 14px; border: 1px solid #e7e5e4;">
        <h2 style="color: #8F0025; font-size: 18px; margin: 0 0 12px;">🏪 New Seller Application Submitted</h2>
        <p style="font-size: 13px; color: #292524; line-height: 1.5; margin: 0 0 14px;">
          A new merchant application has been submitted for store <strong>${storeName}</strong> by <strong>${applicantName || 'Applicant'}</strong>.
        </p>
        <div style="background: #ffffff; padding: 14px; border-radius: 10px; border: 1px solid #e7e5e4; font-size: 12px; margin-bottom: 16px;">
          <p style="margin: 0 0 6px;"><strong>Store Name:</strong> ${storeName}</p>
          <p style="margin: 0 0 6px;"><strong>Applicant Name:</strong> ${applicantName}</p>
          <p style="margin: 0 0 6px;"><strong>Contact:</strong> ${mobile} • ${email}</p>
          ${category ? `<p style="margin: 0 0 6px;"><strong>Category:</strong> ${category}</p>` : ''}
          ${businessType ? `<p style="margin: 0;"><strong>Business Type:</strong> ${businessType}</p>` : ''}
        </div>
        <p style="font-size: 12px; color: #78716c; margin: 0;">Review identity documents and approve or reject at Admin Sellers Governance (/admin/sellers).</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Accreditation', address: env.SMTP.from || env.SMTP.user },
      to: adminEmail,
      subject: `[New Seller Application] ${storeName} by ${applicantName}`,
      html,
      text: `A new seller application has been submitted by ${applicantName} for store "${storeName}". Contact: ${mobile} • ${email}. Category: ${category || 'N/A'}. Review at /admin/sellers.`,
    });
  } catch (err) {
    console.warn('[mail] Failed admin seller alert:', err?.message || err);
    return null;
  }
}

export async function sendProductSubmittedAdminAlertEmail(env, { productName, storeName, price, category }) {
  try {
    if (!env?.SMTP?.host) return null;
    const t = getTransport(env);
    const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL || 'hodit5727@gmail.com';

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Catalog', address: env.SMTP.from || env.SMTP.user },
      to: adminEmail,
      subject: `[Product Pending Approval] ${productName} (₹${price}) — ${storeName}`,
      text: `Merchant "${storeName}" submitted a new product "${productName}" (Category: ${category}, Price: ₹${price}) for verification. Review and approve at /admin/products.`,
    });
  } catch (err) {
    console.warn('[mail] Failed product submit admin alert:', err?.message || err);
    return null;
  }
}

export async function sendProductReviewedSellerEmail(env, { to, productName, status, notes }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Catalog Review', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Product Review: ${productName} — ${status}`,
      text: `Hello, your product "${productName}" status is now ${status}.${notes ? ` Notes: ${notes}` : ''}`,
    });
  } catch (err) {
    console.warn('[mail] Failed seller product review email:', err?.message || err);
    return null;
  }
}

/**
 * Send seller application rejection notification email.
 */
export async function sendSellerRejectedEmail(env, { to, fullName, storeName, reason }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #fff1f2; border-radius: 14px; border: 1px solid #fecdd3;">
        <h2 style="color: #be123c; font-size: 18px; margin: 0 0 10px;">Seller Application Status: Rejected</h2>
        <p style="font-size: 13px; color: #4c0519; line-height: 1.5; margin: 0 0 12px;">
          Hello <strong>${fullName || 'Artisan'}</strong>, thank you for your interest in becoming a merchant for <strong>${storeName || 'your store'}</strong> on K-SHOP.
        </p>
        <p style="font-size: 12px; color: #881337; margin: 0 0 8px;"><strong>Decision Reason:</strong> ${reason || 'Application does not meet current verification requirements.'}</p>
        <p style="font-size: 11px; color: #9f1239; margin: 0;">You may re-apply with updated identity and accreditation documentation through your account dashboard.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Merchant Accreditation', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Seller Application Status Update — ${storeName || 'K-SHOP'}`,
      html,
      text: `Hello ${fullName || 'Artisan'}, your seller application for ${storeName || 'your store'} was not approved. Reason: ${reason || 'Application does not meet current verification requirements.'}`,
    });
  } catch (err) {
    console.warn('[mail] Failed seller rejection email:', err?.message || err);
    return null;
  }
}

/**
 * Send wire settlement payout notification email to the seller.
 */
export async function sendSettlementReleasedSellerEmail(env, { to, storeName, settlementAmount, commissionAmount, netPayout, bankReference }) {
  try {
    if (!env?.SMTP?.host || !to) return null;
    const t = getTransport(env);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #ecfdf5; border-radius: 14px; border: 1px solid #a7f3d0;">
        <h2 style="color: #065f46; font-size: 18px; margin: 0 0 10px;">🏦 Settlement Wire Payout Released</h2>
        <p style="font-size: 13px; color: #064e3b; line-height: 1.5; margin: 0 0 14px;">
          Hello <strong>${storeName}</strong>, your campus marketplace settlement wire has been processed and disbursed.
        </p>
        <div style="background: #ffffff; padding: 16px; border-radius: 10px; border: 1px solid #a7f3d0; margin-bottom: 14px; font-size: 12px;">
          <p style="margin: 0 0 6px; color: #047857;">Gross Amount: <strong>₹${settlementAmount}</strong></p>
          <p style="margin: 0 0 6px; color: #047857;">Platform Commission (5%): <strong>₹${commissionAmount}</strong></p>
          <p style="margin: 0 0 6px; font-size: 15px; font-weight: bold; color: #065f46;">Net Payout Wired (95%): ₹${netPayout}</p>
          <p style="margin: 0; color: #6b7280; font-family: monospace;">Bank Reference: ${bankReference}</p>
        </div>
        <p style="font-size: 12px; color: #047857; margin: 0;">Funds should reflect in your registered bank account within 1-2 banking hours. Thank you for your partnership with K-SHOP.</p>
      </div>
    `;

    return await t.sendMail({
      from: { name: env.SMTP.fromName || 'K-Shop Settlements', address: env.SMTP.from || env.SMTP.user },
      to,
      subject: `Settlement Disbursed: ₹${netPayout} (Wire Ref: ${bankReference}) — K-SHOP`,
      html,
      text: `Hello ${storeName}, your settlement payout of ₹${netPayout} (gross ₹${settlementAmount} minus ₹${commissionAmount} 5% platform fee) has been released. Bank Reference: ${bankReference}.`,
    });
  } catch (err) {
    console.warn('[mail] Failed seller settlement email:', err?.message || err);
    return null;
  }
}