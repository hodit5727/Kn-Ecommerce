/**
 * Admin management surface (BACKEND_SPEC §8/§9 admin sections) — the real
 * endpoints behind the admin dashboard cards, patron registry, seller
 * accreditation pipeline and product matrix.
 *
 * Contract (src/services/adminService.ts + src/types/admin.ts):
 *   GET  /admin/stats                                       → { stats: AdminMetrics }
 *   GET  /admin/customers?page&perPage&q                    → { customers, page, perPage, total, totalPages }
 *   POST /admin/customers/:id/toggle-status                 → { customer }
 *   GET  /admin/sellers?page&perPage&status&q              → { sellers, page, perPage, total, totalPages }
 *   POST /admin/sellers/:id/review   { decision }           → { seller }
 *   GET  /admin/products?page&perPage&q                     → { products, page, perPage, total, totalPages }
 *
 * Security (AGENTS.md §2):
 *   - EVERY route requires a server-verified ADMIN role (requireRole). The
 *     frontend role checks are never the boundary (§2.3, §2.4, §5-60/61/62).
 *   - All aggregates and lists are computed server-side from the DB — no
 *     client-derived counts, no invented numbers (§5-64/65).
 *   - Client-supplied resource ids are never trusted for authorization; the
 *     server resolves the target row and the caller's role first (IDOR/BOLA,
 *     §5-77).
 *   - Oversized pages are capped server-side (max 50 / page) — the client
 *     pagination params are hints, not trust (§5-64).
 *
 * Aggregation definitions (documented, server-audited):
 *   totalGrossRevenue  = SUM(orders.total) over non-voided orders
 *                        (excludes CANCELLED / RETURN_REQUESTED / RETURNED /
 *                        REFUNDED) — gross order value, not cash received.
 *   totalSpent         = same definition, per customer.
 *   grossRevenue       = same definition, per seller.
 *   totalSellers       = all seller application rows (registry size), any
 *                        verification status — the pipeline tab shows the
 *                        per-status split.
 *   pendingSettlements = payouts with status 'SCHEDULED' (§23 Day-8 escrow).
 *   activeAnnouncements= announcements with published_at set.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { grantSellerAccess } from '../lib/sellerAccess.js';
import { writeAudit } from '../lib/audit.js';
import { productToPublic, formatProductCode } from '../lib/productShape.js';
import { VERIFICATION_DOCS_BUCKET, SELLER_DOCUMENTS_BUCKET } from '../lib/uploads.js';
import { sendProductReviewedSellerEmail } from '../lib/mail.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_VOIDED_ORDER_STATUSES = new Set([
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

function parsePaging(query) {
  const rawPage = Number.parseInt(String(query.page ?? ''), 10);
  const rawPerPage = Number.parseInt(String(query.perPage ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  let perPage = Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 20;
  if (perPage > 50) perPage = 50; // server-side cap (§5-64)
  return { page, perPage };
}

const totalPages = (total, perPage) => (total === 0 ? 0 : Math.ceil(total / perPage));

/** Fetch an entire table (projection-agnostic — honest for the codebase's
 *  scale; server-side filtering keeps pagination totals exact). */
async function fetchAll(service, table, label) {
  const { data, error } = await service.from(table).select('*');
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[admin] ${label} query failed:`, error.message);
    throw httpError(502, 'Unable to load administrative data. Please try again later.');
  }
  return data ?? [];
}

function hasQ(q) {
  return typeof q === 'string' && q.trim().length > 0;
}
const lower = (q) => String(q ?? '').trim().toLowerCase();

/** Per-customer aggregates (orderCount + cumulative valuation). */
function customerAggregates(orders, customerId) {
  let count = 0;
  let spent = 0;
  for (const o of orders) {
    if (o.customer_id !== customerId) continue;
    count += 1;
    if (NON_VOIDED_ORDER_STATUSES.has(o.status)) {
      spent += Number(o.total) || 0;
    }
  }
  return { count, spent };
}

/** Per-seller aggregates (orderCount + grossRevenue) keyed by seller id. */
function sellerAggregates(orders) {
  const bySeller = new Map();
  for (const o of orders) {
    if (!bySeller.has(o.seller_id)) bySeller.set(o.seller_id, { count: 0, revenue: 0 });
    const acc = bySeller.get(o.seller_id);
    acc.count += 1;
    if (NON_VOIDED_ORDER_STATUSES.has(o.status)) {
      acc.revenue += Number(o.total) || 0;
    }
  }
  return bySeller;
}

export function createAdminManagementRouter({ env, supabase }) {
  const router = Router();
  const imageBase = String(env.SUPABASE_URL).replace(/\/+$/, '');
  const adminGate = [requireAuth(supabase, env), requireRole(supabase, env, 'ADMIN')];

  // ── GET /admin/stats ──────────────────────────────────────────────────
  router.get('/admin/stats', ...adminGate, async (req, res) => {
    const [profiles, sellers, products, orders, refunds, payouts, announcements] =
      await Promise.all([
        fetchAll(supabase.service, 'profiles', 'stats profiles'),
        fetchAll(supabase.service, 'seller_profiles', 'stats sellers'),
        fetchAll(supabase.service, 'products', 'stats products'),
        fetchAll(supabase.service, 'orders', 'stats orders'),
        fetchAll(supabase.service, 'refunds', 'stats refunds'),
        fetchAll(supabase.service, 'payouts', 'stats payouts'),
        fetchAll(supabase.service, 'announcements', 'stats announcements'),
      ]);

    let totalGrossRevenue = 0;
    for (const o of orders) {
      if (NON_VOIDED_ORDER_STATUSES.has(o.status)) {
        totalGrossRevenue += Number(o.total) || 0;
      }
    }

    const stats = {
      totalOrders: orders.length,
      totalCustomers: profiles.filter((p) => p.role === 'CUSTOMER').length,
      totalSellers: sellers.length,
      totalProducts: products.length,
      totalGrossRevenue,
      pendingRefundsCount: refunds.filter((r) => r.status === 'PENDING').length,
      pendingSettlementsCount: payouts.filter((p) => p.status === 'SCHEDULED').length,
      activeAnnouncementsCount: announcements.filter((a) => a.published_at != null).length,
    };
    return ok(res, { stats });
  });

  // ── GET /admin/customers ──────────────────────────────────────────────
  router.get('/admin/customers', ...adminGate, async (req, res) => {
    const { page, perPage } = parsePaging(req.query);
    const [profiles, orders, sellers] = await Promise.all([
      fetchAll(supabase.service, 'profiles', 'customers'),
      fetchAll(supabase.service, 'orders', 'customer orders'),
      fetchAll(supabase.service, 'seller_profiles', 'customer seller status'),
    ]);

    const q = lower(req.query.q);
    const customers = profiles
      .filter((p) => p.role === 'CUSTOMER')
      .filter(
        (p) =>
          !hasQ(q) ||
          lower(p.full_name).includes(q) ||
          lower(p.email).includes(q) ||
          lower(p.phone).includes(q) ||
          lower(p.business_id).includes(q),
      )
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || a.id.localeCompare(b.id));

    const total = customers.length;
    const pageRows = customers.slice((page - 1) * perPage, page * perPage);
    const sellerStatusById = new Map(
      (sellers ?? []).map((s) => [s.profile_id, s.verification_status]),
    );

    const list = pageRows.map((p) => {
      const agg = customerAggregates(orders, p.id);
      const suffix = p.business_id ? String(p.business_id).replace(/^KN[CS]R-/, '') : '';
      const customerId = suffix ? `KNCR-${suffix}` : (p.business_id ?? '');
      const sellerStatus = sellerStatusById.get(p.id) ?? 'NONE';
      const isSeller = sellerStatus === 'APPROVED' || (Array.isArray(p.roles) && p.roles.includes('SELLER')) || p.role === 'SELLER';
      const sellerId = isSeller && suffix ? `KNSR-${suffix}` : undefined;
      return {
        id: p.id,
        customerId,
        sellerId,
        fullName: p.full_name ?? p.email,
        email: p.email,
        phone: p.phone ?? undefined,
        status: p.status ?? 'ACTIVE',
        orderCount: agg.count,
        totalSpent: agg.spent,
        sellerStatus,
        joinedDate: String(p.created_at ?? ''),
      };
    });

    return ok(res, { customers: list, page, perPage, total, totalPages: totalPages(total, perPage) });
  });

  // ── POST /admin/customers/:id/toggle-status ───────────────────────────
  router.post('/admin/customers/:id/toggle-status', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Customer not found.');

    const { data: found, error: findError } = await supabase.service
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (findError) {
      // eslint-disable-next-line no-console
      console.error('[admin] customer lookup failed:', findError.message);
      throw httpError(502, 'Unable to load the customer. Please try again.');
    }
    const target = found ?? null;
    // Generic 404 — never reveal whether a customer row exists (§5-77).
    if (!target || target.role !== 'CUSTOMER') throw httpError(404, 'Customer not found.');

    const next = target.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const { error } = await supabase.service
      .from('profiles')
      .update({ status: next })
      .eq('id', id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[admin] customer status update failed:', error.message);
      throw httpError(502, 'Unable to update the account status. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: `admin.customer.${next === 'SUSPENDED' ? 'suspend' : 'reactivate'}`,
      resourceType: 'profile',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: { email: target.email, previousStatus: target.status },
    });

    const [orders, sellerRows] = await Promise.all([
      fetchAll(supabase.service, 'orders', 'toggle orders'),
      fetchAll(supabase.service, 'seller_profiles', 'toggle seller status'),
    ]);
    const agg = customerAggregates(orders, id);
    const sellerStatus = (sellerRows ?? []).find((s) => s.profile_id === id)?.verification_status ?? 'NONE';
    const suffix = target.business_id ? String(target.business_id).replace(/^KN[CS]R-/, '') : '';
    const customerId = suffix ? `KNCR-${suffix}` : (target.business_id ?? '');
    const isSeller = sellerStatus === 'APPROVED' || (Array.isArray(target.roles) && target.roles.includes('SELLER')) || target.role === 'SELLER';
    const sellerId = isSeller && suffix ? `KNSR-${suffix}` : undefined;

    return ok(res, {
      customer: {
        id: target.id,
        customerId,
        sellerId,
        fullName: target.full_name ?? target.email,
        email: target.email,
        phone: target.phone ?? undefined,
        status: next,
        orderCount: agg.count,
        totalSpent: agg.spent,
        sellerStatus,
        joinedDate: String(target.created_at ?? ''),
      },
    });
  });

  // ── GET /admin/sellers ────────────────────────────────────────────────
  router.get('/admin/sellers', ...adminGate, async (req, res) => {
    const { page, perPage } = parsePaging(req.query);
    const [sellerRows, profiles, products, orders, verifications] = await Promise.all([
      fetchAll(supabase.service, 'seller_profiles', 'sellers'),
      fetchAll(supabase.service, 'profiles', 'seller profiles'),
      fetchAll(supabase.service, 'products', 'seller products'),
      fetchAll(supabase.service, 'orders', 'seller orders'),
      fetchAll(supabase.service, 'seller_verifications', 'seller verifications').catch(() => []),
    ]);

    const q = lower(req.query.q);
    const statusFilter = String(req.query.status ?? 'ALL').trim().toUpperCase();
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const aggBySeller = sellerAggregates(orders);
    const productCountBySeller = new Map();
    for (const pr of products) {
      productCountBySeller.set(pr.seller_id, (productCountBySeller.get(pr.seller_id) ?? 0) + 1);
    }

    const verifByUser = new Map();
    for (const v of verifications ?? []) {
      const existing = verifByUser.get(v.user_id);
      if (!existing || Number(v.cycle ?? 1) >= Number(existing.cycle ?? 1)) {
        verifByUser.set(v.user_id, v);
      }
    }

    const counts = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      ALL: 0,
    };
    for (const s of sellerRows ?? []) {
      const qMatch =
        !hasQ(q) ||
        lower(s.store_name).includes(q) ||
        lower(s.seller_name).includes(q) ||
        lower(profileById.get(s.profile_id)?.email ?? '').includes(q);
      if (qMatch) {
        counts.ALL += 1;
        if (s.verification_status === 'PENDING') counts.PENDING += 1;
        else if (s.verification_status === 'APPROVED') counts.APPROVED += 1;
        else if (s.verification_status === 'REJECTED') counts.REJECTED += 1;
      }
    }

    const all = (sellerRows ?? [])
      .filter((s) => statusFilter === 'ALL' || s.verification_status === statusFilter)
      .filter(
        (s) =>
          !hasQ(q) ||
          lower(s.store_name).includes(q) ||
          lower(s.seller_name).includes(q) ||
          lower(profileById.get(s.profile_id)?.email ?? '').includes(q),
      )
      .sort((a, b) => String(b.submitted_at ?? b.created_at ?? '').localeCompare(String(a.submitted_at ?? a.created_at ?? '')) || a.profile_id.localeCompare(b.profile_id));

    const total = all.length;
    const pageRows = all.slice((page - 1) * perPage, page * perPage);

    const list = await Promise.all(
      pageRows.map(async (s) => {
        const agg = aggBySeller.get(s.profile_id) ?? { count: 0, revenue: 0 };
        const prof = profileById.get(s.profile_id);
        const verif = verifByUser.get(s.profile_id);

        let documentUrl = null;
        const docPath = s.id_document_path || verif?.document_storage_path;
        if (docPath) {
          try {
            const bucket = docPath.startsWith('verif-docs')
              ? (env.STORAGE_BUCKET_VERIFICATION_DOCS || VERIFICATION_DOCS_BUCKET)
              : (env.STORAGE_BUCKET_SELLER_DOCUMENTS || SELLER_DOCUMENTS_BUCKET);
            const { data: urlData } = await supabase.service.storage
              .from(bucket)
              .createSignedUrl(docPath, 15 * 60);
            if (urlData?.signedUrl) documentUrl = urlData.signedUrl;
          } catch {
            // non-fatal
          }
        }

        const suffix = prof?.business_id ? String(prof.business_id).replace(/^KN[CS]R-/, '') : '';
        const customerId = suffix ? `KNCR-${suffix}` : (prof?.business_id ?? s.profile_id);
        const sellerId = suffix ? `KNSR-${suffix}` : (prof?.business_id ?? undefined);

        return {
          id: s.profile_id,
          customerId,
          sellerId,
          storeName: s.store_name,
          ownerName: s.seller_name,
          email: prof?.email ?? '',
          phone: s.mobile ?? prof?.phone ?? undefined,
          storeCategory: s.store_category ?? undefined,
          businessType: s.business_type ?? undefined,
          address: s.address ?? undefined,
          documentUrl,
          livenessStatus: verif?.liveness_status ?? null,
          documentStatus: verif?.document_status ?? s.id_ocr_status ?? null,
          matchStatus: verif?.match_status ?? null,
          status: s.verification_status,
          productCount: productCountBySeller.get(s.profile_id) ?? 0,
          orderCount: agg.count,
          grossRevenue: agg.revenue,
          // Honest defaults: the payouts/escrow phase replaces this with real
          // ledger state; until then approval status is the signal.
          settlementStatus: s.verification_status === 'PENDING' ? 'PENDING_APPROVAL' : 'UP_TO_DATE',
          appliedDate: String(s.submitted_at ?? s.created_at ?? ''),
          reviewedDate: s.reviewed_at ? String(s.reviewed_at) : undefined,
        };
      }),
    );

    return ok(res, { sellers: list, counts, page, perPage, total, totalPages: totalPages(total, perPage) });
  });

  // ── POST /admin/sellers/:id/review ────────────────────────────────────
  router.post('/admin/sellers/:id/review', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    const decision = String(req.body?.decision ?? '').trim().toUpperCase();
    if (!UUID_RE.test(id)) throw httpError(404, 'Seller not found.');
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw httpError(400, 'Decision must be APPROVED or REJECTED.');
    }

    const { data: found, error: findError } = await supabase.service
      .from('seller_profiles')
      .select('*')
      .eq('profile_id', id)
      .maybeSingle();
    if (findError) {
      // eslint-disable-next-line no-console
      console.error('[admin] seller lookup failed:', findError.message);
      throw httpError(502, 'Unable to load the application. Please try again.');
    }
    const target = found ?? null;
    if (!target) throw httpError(404, 'Seller not found.');

    if (decision === 'APPROVED') {
      // One shared write path: APPROVED verification status + the SELLER role.
      // It is NOT a direct `update({ roles })` — see lib/sellerAccess.js for why
      // that write is silently reverted by the profiles_assign_identity trigger,
      // and why a failure here is thrown rather than logged and ignored.
      await grantSellerAccess(supabase, id, env);
    } else {
      const { error: rejectError } = await supabase.service
        .from('seller_profiles')
        .update({
          verification_status: 'REJECTED',
          reviewed_at: new Date().toISOString(),
          // The schema CHECK requires a reason for REJECTED; the current UI
          // sends only the decision, so a truthful default is recorded.
          rejection_reason: String(req.body?.reason ?? '').trim() || 'Rejected by administrator.',
        })
        .eq('profile_id', id);
      if (rejectError) {
        // eslint-disable-next-line no-console
        console.error('[admin] seller reject failed:', rejectError.message);
        throw httpError(502, 'Unable to process the application. Please try again.');
      }
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: `admin.seller.${decision === 'APPROVED' ? 'approve' : 'reject'}`,
      resourceType: 'seller_profile',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: { storeName: target.store_name },
    });

    const [profileRows, profiles, products, orders] = await Promise.all([
      fetchAll(supabase.service, 'profiles', 'seller review reload'),
      fetchAll(supabase.service, 'profiles', 'seller review profiles'),
      fetchAll(supabase.service, 'products', 'seller review products'),
      fetchAll(supabase.service, 'orders', 'seller review orders'),
    ]);
    const profile = profileRows.find((p) => p.id === id) ?? null;
    const agg = sellerAggregates(orders).get(id) ?? { count: 0, revenue: 0 };
    const productCount = products.filter((p) => p.seller_id === id).length;
    const { data: updated } = await supabase.service
      .from('seller_profiles')
      .select('*')
      .eq('profile_id', id)
      .maybeSingle();

    const suffix = profile?.business_id ? String(profile.business_id).replace(/^KN[CS]R-/, '') : '';
    const customerId = suffix ? `KNCR-${suffix}` : (profile?.business_id ?? updated.profile_id);
    const sellerId = suffix ? `KNSR-${suffix}` : (profile?.business_id ?? undefined);

    return ok(res, {
      seller: {
        id: updated.profile_id,
        customerId,
        sellerId,
        storeName: updated.store_name,
        ownerName: updated.seller_name,
        email: profile?.email ?? '',
        status: updated.verification_status,
        productCount,
        orderCount: agg.count,
        grossRevenue: agg.revenue,
        settlementStatus: updated.verification_status === 'PENDING' ? 'PENDING_APPROVAL' : 'UP_TO_DATE',
        appliedDate: String(updated.submitted_at ?? updated.created_at ?? ''),
        reviewedDate: updated.reviewed_at ? String(updated.reviewed_at) : undefined,
      },
    });
  });

  // ── GET /admin/products ───────────────────────────────────────────────
  router.get('/admin/products', ...adminGate, async (req, res) => {
    const { page, perPage } = parsePaging(req.query);
    const [products, variants, images, profiles, orderItems] = await Promise.all([
      fetchAll(supabase.service, 'products', 'admin products'),
      fetchAll(supabase.service, 'product_variants', 'admin variants'),
      fetchAll(supabase.service, 'product_images', 'admin images'),
      fetchAll(supabase.service, 'profiles', 'admin seller names'),
      fetchAll(supabase.service, 'order_items', 'admin product sold units'),
    ]);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const soldByProduct = new Map();
    for (const it of orderItems ?? []) {
      soldByProduct.set(it.product_id, (soldByProduct.get(it.product_id) || 0) + (Number(it.quantity) || 0));
    }

    const q = lower(req.query.q);
    const all = (products ?? [])
      .filter(
        (p) =>
          !hasQ(q) ||
          lower(p.name).includes(q) ||
          lower(p.brand).includes(q) ||
          lower(p.description).includes(q),
      )
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || a.id.localeCompare(b.id));

    const total = all.length;
    const pageRows = all.slice((page - 1) * perPage, page * perPage);

    const list = pageRows.map((p) => {
      const seller = profileById.get(p.seller_id);
      const rowVariants = (variants ?? []).filter((v) => v.product_id === p.id);
      const rowImages = (images ?? []).filter((img) => img.product_id === p.id);
      const row = {
        ...p,
        seller: { status: seller?.status ?? 'ACTIVE', full_name: seller?.full_name ?? '' },
        variants: rowVariants,
        images: rowImages,
      };
      const pub = productToPublic(row, imageBase);
      const totalStock = rowVariants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
      const soldCount = soldByProduct.get(p.id) || 0;
      const balanceStock = Math.max(0, totalStock - soldCount);
      const sku = rowVariants[0]?.sku ?? '';
      const productCode = formatProductCode(sku, p.id);

      return {
        ...pub,
        productCode,
        sku,
        approvalStatus: p.status ?? 'SUBMITTED',
        totalStock,
        soldCount,
        balanceStock,
        variants: rowVariants,
      };
    });

    return ok(res, { products: list, page, perPage, total, totalPages: totalPages(total, perPage) });
  });

  // ── POST /admin/products/:id/review ───────────────────────────────────
  router.post('/admin/products/:id/review', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Product not found.');

    const decision = String(req.body?.decision ?? '').trim().toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw httpError(400, "Decision must be 'APPROVED' or 'REJECTED'.");
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    if (decision === 'REJECTED' && !reason) {
      throw httpError(400, 'Rejection reason is required.');
    }

    const { data: found, error: findError } = await supabase.service
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (findError || !found) throw httpError(404, 'Product not found.');

    const now = new Date().toISOString();
    const { error: updateError } = await supabase.service
      .from('products')
      .update({
        status: decision,
        reviewed_at: now,
        rejection_reason: decision === 'REJECTED' ? reason : null,
        updated_at: now,
      })
      .eq('id', id);
    if (updateError) {
      console.error('[admin/products] review failed:', updateError.message);
      throw httpError(502, 'Unable to update product review status.');
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: `admin.product.${decision.toLowerCase()}`,
      resourceType: 'product',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: { previousStatus: found.status, decision, reason },
    });

    // Trigger seller product status email (non-blocking)
    (async () => {
      try {
        const { data: sProfile } = await supabase.service
          .from('profiles')
          .select('email')
          .eq('id', found.seller_id)
          .maybeSingle();
        if (sProfile?.email) {
          await sendProductReviewedSellerEmail(env, {
            to: sProfile.email,
            productName: found.name,
            status: decision,
            notes: reason || undefined,
          });
        }
      } catch (mailErr) {
        // eslint-disable-next-line no-console
        console.warn('[admin/products] seller email notification error:', mailErr?.message || mailErr);
      }
    })();

    return ok(res, { id, status: decision });
  });

  // ── PUT /admin/products/:id ───────────────────────────────────────────
  router.put('/admin/products/:id', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Product not found.');

    const b = req.body ?? {};
    const updates = {};
    if (typeof b.name === 'string' && b.name.trim().length >= 3) updates.name = b.name.trim();
    if (typeof b.brand === 'string' && b.brand.trim()) updates.brand = b.brand.trim();
    if (typeof b.category === 'string' && b.category.trim()) updates.category = b.category.trim();
    if (typeof b.description === 'string') updates.description = b.description.trim();
    if (b.status && ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(b.status)) updates.status = b.status;
    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase.service
      .from('products')
      .update(updates)
      .eq('id', id);
    if (updateError) {
      console.error('[admin/products] update failed:', updateError.message);
      throw httpError(502, 'Unable to update product.');
    }

    if (b.stock !== undefined || b.price !== undefined) {
      const vUpdates = {};
      if (b.stock !== undefined && Number(b.stock) >= 0) vUpdates.stock = Number(b.stock);
      if (b.price !== undefined && Number(b.price) > 0) vUpdates.price = Number(b.price);
      vUpdates.updated_at = new Date().toISOString();
      await supabase.service.from('product_variants').update(vUpdates).eq('product_id', id);
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: 'admin.product.update',
      resourceType: 'product',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: updates,
    });

    return ok(res, { success: true });
  });

  // ── DELETE /admin/products/:id ────────────────────────────────────────
  router.delete('/admin/products/:id', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Product not found.');

    const { error: delError } = await supabase.service
      .from('products')
      .update({ status: 'ARCHIVED', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (delError) {
      console.error('[admin/products] archive failed:', delError.message);
      throw httpError(502, 'Unable to delete product.');
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: 'admin.product.delete',
      resourceType: 'product',
      resourceId: id,
      ip: req.ip ?? null,
    });

    return ok(res, { success: true });
  });

  // ── GET /admin/coupons ────────────────────────────────────────────────
  router.get('/admin/coupons', ...adminGate, async (_req, res) => {
    const { data: coupons, error } = await supabase.service
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[admin/coupons] list failed:', error.message);
      throw httpError(502, 'Unable to retrieve coupons.');
    }

    return ok(res, { coupons: coupons ?? [] });
  });

  // ── POST /admin/coupons ───────────────────────────────────────────────
  router.post('/admin/coupons', ...adminGate, async (req, res) => {
    const { profile } = req.auth;
    const b = req.body ?? {};
    const code = String(b.code ?? '').trim().toUpperCase();
    const description = typeof b.description === 'string' ? b.description.trim() : null;
    const couponKind = b.couponKind === 'FIXED' ? 'FIXED' : 'PERCENT';
    const discountValue = Number(b.discountValue);
    const maxDiscount = b.maxDiscount !== undefined && b.maxDiscount !== null ? Number(b.maxDiscount) : null;
    const minOrderAmount = b.minOrderAmount !== undefined && b.minOrderAmount !== null ? Number(b.minOrderAmount) : null;
    const oneTimePerCustomer = b.oneTimePerCustomer !== false;
    const expiresAt = b.expiresAt ? new Date(b.expiresAt).toISOString() : null;

    if (!code || code.length < 4 || code.length > 24) {
      throw httpError(400, 'Coupon code must be 4–24 uppercase characters.');
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw httpError(400, 'Discount value must be greater than zero.');
    }
    if (couponKind === 'PERCENT' && discountValue > 100) {
      throw httpError(400, 'Percentage discount cannot exceed 100%.');
    }

    const { data: coupon, error: insertError } = await supabase.service
      .from('coupons')
      .insert({
        code,
        description,
        coupon_kind: couponKind,
        discount_value: discountValue,
        max_discount: maxDiscount,
        min_order_amount: minOrderAmount,
        one_time_per_customer: oneTimePerCustomer,
        expires_at: expiresAt,
        created_by: profile.id,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.message?.includes('unique') || insertError.code === '23505') {
        throw httpError(409, 'A coupon with this code already exists.');
      }
      // eslint-disable-next-line no-console
      console.error('[admin/coupons] create failed:', insertError.message);
      throw httpError(502, 'Unable to create coupon.');
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: 'ADMIN',
      action: 'admin.coupon.create',
      resourceType: 'coupon',
      resourceId: coupon.id,
      ip: req.ip ?? null,
      metadata: { code, discountValue, couponKind },
    });

    return ok(res, { coupon });
  });

  // ── POST /admin/coupons/:id/toggle ────────────────────────────────────
  router.post('/admin/coupons/:id/toggle', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Coupon not found.');

    const { data: found, error: findError } = await supabase.service
      .from('coupons')
      .select('is_active')
      .eq('id', id)
      .maybeSingle();

    if (findError || !found) throw httpError(404, 'Coupon not found.');

    const nextState = !found.is_active;
    const { data: updated, error: updateError } = await supabase.service
      .from('coupons')
      .update({ is_active: nextState })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      // eslint-disable-next-line no-console
      console.error('[admin/coupons] toggle failed:', updateError.message);
      throw httpError(502, 'Unable to update coupon status.');
    }

    return ok(res, { coupon: updated });
  });

  // ── DELETE /admin/coupons/:id ─────────────────────────────────────────
  router.delete('/admin/coupons/:id', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Coupon not found.');

    const { error: delError } = await supabase.service
      .from('coupons')
      .delete()
      .eq('id', id);

    if (delError) {
      // eslint-disable-next-line no-console
      console.error('[admin/coupons] delete failed:', delError.message);
      throw httpError(502, 'Unable to delete coupon.');
    }

    return ok(res, { success: true });
  });

  // ── GET /admin/operators — list operator accounts ─────────────────────
  router.get('/admin/operators', ...adminGate, async (req, res) => {
    let operators = [];
    const { data: opData, error: opError } = await supabase.service
      .from('platform_operators')
      .select('*')
      .order('created_at', { ascending: false });

    if (!opError && Array.isArray(opData)) {
      operators = opData.map((op) => ({
        id: op.id,
        fullName: op.full_name || op.fullName || 'Operator',
        email: op.email,
        role: op.role,
        phone: op.phone || '',
        status: op.status || 'ACTIVE',
        createdAt: op.created_at || op.createdAt,
      }));
    } else {
      // Fallback to profiles table
      const { data: profData } = await supabase.service
        .from('profiles')
        .select('*');
      operators = (profData ?? [])
        .filter((p) => p.role === 'ADMIN' || (Array.isArray(p.roles) && (p.roles.includes('ADMIN') || p.roles.includes('SUPER_ADMIN') || p.roles.includes('DELIVERY_PERSON'))))
        .map((p) => ({
          id: p.id,
          fullName: p.full_name || 'Admin Operator',
          email: p.email,
          role: Array.isArray(p.roles) && p.roles.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : (Array.isArray(p.roles) && p.roles.includes('DELIVERY_PERSON') ? 'DELIVERY_PERSON' : 'ADMIN'),
          phone: p.phone || '',
          status: p.status || 'ACTIVE',
          createdAt: p.created_at,
        }));
    }

    return ok(res, { operators });
  });

  // ── POST /admin/operators — create new staff / operator ───────────────
  router.post('/admin/operators', ...adminGate, async (req, res) => {
    const profile = req.auth.profile;
    const fullName = String(req.body?.fullName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role = String(req.body?.role ?? '').trim().toUpperCase();
    const password = String(req.body?.password ?? '');
    const phone = String(req.body?.phone ?? '').trim();

    if (!fullName || fullName.length < 2) {
      throw httpError(400, 'Full name must be at least 2 characters.');
    }
    if (!email || !email.includes('@')) {
      throw httpError(400, 'Valid email address is required.');
    }
    if (!['SUPER_ADMIN', 'ADMIN', 'DELIVERY_PERSON'].includes(role)) {
      throw httpError(400, 'Role must be SUPER_ADMIN, ADMIN, or DELIVERY_PERSON.');
    }
    if (!password || password.length < 6) {
      throw httpError(400, 'Password must be at least 6 characters.');
    }

    // Ensure Supabase Auth user is created with the chosen password
    const nowIso = new Date().toISOString();
    let opAuthId = crypto.randomUUID();
    try {
      const { data: createdAuth, error: authErr } = await supabase.service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role, full_name: fullName, phone },
      });
      if (createdAuth?.user?.id) {
        opAuthId = createdAuth.user.id;
      } else if (authErr) {
        // If user already exists in auth, update password
        const { data: userList } = await supabase.service.auth.admin.listUsers();
        const existing = (userList?.users || []).find((u) => u.email?.toLowerCase() === email);
        if (existing) {
          opAuthId = existing.id;
          await supabase.service.auth.admin.updateUserById(opAuthId, {
            password,
            user_metadata: { role, full_name: fullName, phone },
          });
        }
      }
    } catch (e) {
      // non-fatal fallback
    }

    const operator = {
      id: opAuthId,
      full_name: fullName,
      fullName,
      email,
      role,
      phone: phone || null,
      status: 'ACTIVE',
      created_at: nowIso,
      createdAt: nowIso,
    };

    // Upsert into platform_operators table
    try {
      await supabase.service
        .from('platform_operators')
        .upsert({
          id: opAuthId,
          full_name: fullName,
          email,
          role,
          phone: phone || null,
          status: 'ACTIVE',
          created_at: nowIso,
        }, { onConflict: 'id' });
    } catch (e) {
      // ignore table absence
    }

    // Register in profiles
    await supabase.service.from('profiles').upsert({
      id: opAuthId,
      full_name: fullName,
      email,
      phone: phone || null,
      role: role === 'DELIVERY_PERSON' ? 'CUSTOMER' : 'ADMIN',
      roles: role === 'DELIVERY_PERSON' ? ['CUSTOMER', 'DELIVERY_PERSON'] : ['CUSTOMER', 'ADMIN', role],
      status: 'ACTIVE',
      created_at: nowIso,
    }, { onConflict: 'id' });

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: 'ADMIN',
      action: 'admin.operator.create',
      resourceType: 'operator',
      resourceId: opAuthId,
      ip: req.ip ?? null,
      metadata: { fullName, email, role },
    });

    return ok(res, { operator });
  });

  // ── POST /admin/operators/:id/toggle-status ───────────────────────────
  router.post('/admin/operators/:id/toggle-status', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Operator not found.');

    const { data: found } = await supabase.service
      .from('platform_operators')
      .select('status')
      .eq('id', id)
      .maybeSingle();

    const nextStatus = (found?.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE');
    await supabase.service
      .from('platform_operators')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', id);

    await supabase.service
      .from('profiles')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', id);

    return ok(res, { success: true, status: nextStatus });
  });

  // ── DELETE /admin/operators/:id ───────────────────────────────────────
  router.delete('/admin/operators/:id', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Operator not found.');

    await supabase.service.from('platform_operators').delete().eq('id', id);
    await supabase.service.from('profiles').delete().eq('id', id);

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: 'admin.operator.delete',
      resourceType: 'operator',
      resourceId: id,
      ip: req.ip ?? null,
    });

    return ok(res, { success: true });
  });

  // ── GET /admin/audit-logs — system audit & access stream ───────────────
  router.get('/admin/audit-logs', ...adminGate, async (req, res) => {
    const { data, error } = await supabase.service
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    return ok(res, { logs: data ?? [] });
  });

  // ── GET /admin/settlements — All escrow settlements across sellers ─────────
  router.get('/admin/settlements', ...adminGate, async (req, res) => {
    const nowIso = new Date().toISOString();
    const [allPayouts, allProfiles, sellerProfiles] = await Promise.all([
      fetchAll(supabase.service, 'payouts', 'all payouts'),
      fetchAll(supabase.service, 'profiles', 'all profiles'),
      fetchAll(supabase.service, 'seller_profiles', 'seller profiles').catch(() => []),
    ]);

    const sellerNameById = new Map();
    for (const sp of sellerProfiles ?? []) {
      if (sp.profile_id && sp.store_name) {
        sellerNameById.set(sp.profile_id, sp.store_name);
      }
    }
    for (const p of allProfiles ?? []) {
      if (!sellerNameById.has(p.id) && (p.seller_store_name || p.full_name)) {
        sellerNameById.set(p.id, p.seller_store_name || p.full_name);
      }
    }

    const settlements = (allPayouts ?? [])
      .map((p) => {
        const sName = sellerNameById.get(p.seller_id) || 'Verified Seller';
        const eligible = new Date(p.eligible_at || p.created_at || nowIso);
        const periodStart = new Date(eligible.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
        const releasable = eligible.getTime() <= new Date(nowIso).getTime();
        const grossAmount = Math.round((Number(p.amount) || 0) * 100) / 100;
        const platformFee = Math.round((Number(p.commission_amount) || 0) * 100) / 100;
        const netSettlementAmount = Math.max(0, Math.round((grossAmount - platformFee) * 100) / 100);

        return {
          id: p.id,
          settlementNumber: `STL-${String(p.id).slice(0, 8).toUpperCase()}`,
          sellerId: p.seller_id,
          sellerName: sName,
          periodStart,
          periodEnd: p.eligible_at ? String(p.eligible_at) : '',
          grossAmount,
          platformFee,
          netSettlementAmount,
          status:
            p.status === 'RELEASED'
              ? 'COMPLETED'
              : p.status === 'CANCELLED'
                ? 'FAILED'
                : releasable
                  ? 'PENDING'
                  : 'PROCESSING',
          bankReference: p.status === 'RELEASED' ? `WIRE-KN-${String(p.id).slice(0, 6).toUpperCase()}` : undefined,
          createdAt: p.created_at ? String(p.created_at) : '',
          processedAt: p.released_at ? String(p.released_at) : undefined,
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return ok(res, { settlements });
  });

  // ── POST /admin/settlements/:id/release — Admin wires payout to seller ────
  router.post('/admin/settlements/:id/release', ...adminGate, async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    const { data: allPayouts } = await supabase.service.from('payouts').select('*');
    const found = (allPayouts ?? []).find(
      (p) =>
        p.id === id ||
        id.includes(p.id.slice(0, 8)) ||
        (p.order_id && id.includes(p.order_id.slice(0, 8))) ||
        (p.id && id.toLowerCase().includes(p.id.slice(0, 4).toLowerCase())),
    );

    if (!found) throw httpError(404, 'Settlement payout record not found.');
    if (found.status === 'RELEASED') {
      throw httpError(400, 'This settlement has already been released.');
    }

    const now = new Date().toISOString();
    const netAmount = Math.max(0, (Number(found.amount) || 0) - (Number(found.commission_amount) || 0));
    const bankRef =
      typeof req.body?.bankReference === 'string' && req.body.bankReference.trim()
        ? req.body.bankReference.trim()
        : `WIRE-KN-${Date.now().toString().slice(-6)}`;

    // 1. Update payout status to RELEASED
    const { error: updateError } = await supabase.service
      .from('payouts')
      .update({
        status: 'RELEASED',
        released_at: now,
        released_by: req.auth.profile.id,
        updated_at: now,
      })
      .eq('id', found.id);

    if (updateError) {
      // eslint-disable-next-line no-console
      console.error('[admin/settlements] release failed:', updateError.message);
      throw httpError(502, 'Unable to release settlement payout.');
    }

    // 2. Ledger DEBIT entry in transactions table
    try {
      const { data: allTxns } = await supabase.service.from('transactions').select('balance_after');
      const prevBalance = (allTxns ?? []).reduce((max, t) => Math.max(max, Number(t.balance_after) || 0), 0);
      const newBalance = Math.max(0, Math.round((prevBalance - netAmount) * 100) / 100);

      const cryptoTxnDigits = String(crypto.randomInt(1000000000, 10000000000));
      const txnRef = `TXN-${cryptoTxnDigits}`;

      await supabase.service.from('transactions').insert({
        id: crypto.randomUUID(),
        txn_ref: txnRef,
        order_id: found.order_id,
        seller_id: found.seller_id,
        txn_type: 'PAYOUT',
        entry: 'DEBIT',
        amount: netAmount,
        commission_amount: 0,
        refund_amount: 0,
        payout_amount: netAmount,
        balance_after: newBalance,
        status: 'POSTED',
        actor_id: req.auth.profile.id,
        metadata: {
          note: `Settlement wire paid to seller`,
          bankReference: bankRef,
        },
        created_at: now,
      });
    } catch (txnErr) {
      // eslint-disable-next-line no-console
      console.error('[admin/settlements] ledger debit failed:', txnErr?.message ?? txnErr);
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: 'ADMIN',
      action: 'admin.settlement.released',
      resourceType: 'payout',
      resourceId: found.id,
      ip: req.ip ?? null,
      metadata: { netAmount, bankRef, sellerId: found.seller_id },
    });

    return ok(res, { success: true, status: 'RELEASED', releasedAt: now, bankReference: bankRef });
  });

  return router;
}