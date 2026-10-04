/**
 * Announcements (BACKEND_SPEC §27 — navbar bell / campaign board).
 * Contract (src/services/announcementService.ts + src/types/announcement.ts):
 *
 *   GET    /announcements                 → { announcements }  (public)
 *   POST   /admin/announcements           → { announcement }   (ADMIN)
 *   PUT    /admin/announcements/:id       → { announcement }   (ADMIN)
 *   DELETE /admin/announcements/:id       → { success }        (ADMIN)
 *
 * Security:
 * - GET is public but SESSION-SCOPED: an anonymous visitor only ever sees the
 *   ALL audience; a signed-in customer sees ALL+CUSTOMERS, a seller sees
 *   ALL+SELLERS, an admin sees everything. The client cannot choose its
 *   audience (the service's targetAudience param is ignored).
 * - The 0005 storage columns model an announcement LIFECYCLE (priority,
 *   starts_at/ends_at window, status) that 0001's table lacked. Rows whose
 *   window has not opened or has already closed are hidden even when their
 *   status still says ACTIVE — the window is computed from server time.
 * - Admin writes are role-gated server-side (requireRole ADMIN). `createdBy`
 *   in the payload is overwritten with the session admin's id — a client can
 *   never attribute an announcement to someone else (§5-60/63/77).
 */
import { Router } from 'express';
import {
  httpError,
  ok,
  withReadRetry,
  isTransientUpstreamError,
  describeUpstreamError,
  HttpError,
} from '../lib/errors.js';
import { requireAuth, requireRole, resolveSession } from '../middleware/auth.js';
import { isApprovedSeller as isSeller } from '../middleware/seller.js';
import { writeAudit } from '../lib/audit.js';
import { validate } from '../lib/schema.js';
import { getSessionTokens } from '../lib/cookies.js';
import { loadProfileRow } from '../lib/profile.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIENCES = ['ALL', 'ALL_CUSTOMERS', 'ALL_SELLERS'];
const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'];
const STATUSES = ['ACTIVE', 'SCHEDULED', 'ARCHIVED'];

const FRONTEND_TO_DB_AUDIENCE = { ALL: 'ALL', ALL_CUSTOMERS: 'CUSTOMERS', ALL_SELLERS: 'SELLERS' };
const DB_TO_FRONTEND_AUDIENCE = { ALL: 'ALL', CUSTOMERS: 'ALL_CUSTOMERS', SELLERS: 'ALL_SELLERS' };

/** Parses an optional ISO-ish date string; '' / null → null; invalid → throws
 *  a clean 400 (never silently accepts a mangled date). */
function optionalIso(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw httpError(400, `${label} must be a valid date.`);
  }
  return d.toISOString();
}

/** Public-route profile resolution: signed-in ACTIVE session → profile,
 *  anything else (missing cookie, expired, suspended) → null (anonymous). */
async function resolveOptionalProfile(supabase, req) {
  try {
    const tokens = getSessionTokens(req);
    const { user } = await resolveSession(supabase, tokens);
    const profile = await loadProfileRow(supabase.service, user.id);
    if (!profile || profile.status !== 'ACTIVE') return null;
    return profile;
  } catch {
    return null; // expected for anonymous visitors on a public route
  }
}

/** Maps DB rows → frontend Announcement (all values read, never invented). */
async function shapeAnnouncements(supabase, rows) {
  if (!rows.length) return [];
  const creatorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  const { data: creatorRows = [] } = await supabase.service
    .from('profiles')
    .select('id, full_name, email')
    .in('id', creatorIds);
  const creatorById = new Map(creatorRows.map((p) => [p.id, p]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? '',
    message: r.body ?? '',
    audience: DB_TO_FRONTEND_AUDIENCE[r.audience] ?? 'ALL',
    priority: r.priority ?? 'NORMAL',
    startDate: r.starts_at ?? r.published_at ?? '',
    endDate: r.ends_at ?? '',
    status: r.status ?? 'ACTIVE',
    createdBy: (r.created_by && (creatorById.get(r.created_by)?.full_name || creatorById.get(r.created_by)?.email)) || '',
    createdAt: r.created_at ? String(r.created_at) : '',
  }));
}

const CREATE_SCHEMA = {
  title: { type: 'string', required: true, min: 1, max: 140, label: 'Title' },
  message: { type: 'string', required: true, min: 1, max: 5000, label: 'Message' },
  audience: { type: 'string', enum: AUDIENCES, label: 'Audience' },
  priority: { type: 'string', enum: PRIORITIES, label: 'Priority' },
  startDate: { type: 'string', max: 60, label: 'Start date' },
  endDate: { type: 'string', max: 60, label: 'End date' },
  status: { type: 'string', enum: STATUSES, label: 'Status' },
};

/** Partial-update schema (PUT) — every field optional; only provided fields
 *  change, so an admin can update a single attribute without resending the
 *  announcement (the create schema would reject a partial body). */
const UPDATE_SCHEMA = {
  ...CREATE_SCHEMA,
  title: { type: 'string', min: 1, max: 140, label: 'Title' },
  message: { type: 'string', min: 1, max: 5000, label: 'Message' },
};

export function createAnnouncementsRouter({ env, supabase }) {
  const router = Router();

  // ── GET /announcements — public, audience-scoped by session ──────────────
  router.get('/announcements', async (req, res) => {
    const profile = await resolveOptionalProfile(supabase, req);
    const nowIso = new Date().toISOString();
    const now = new Date(nowIso).getTime();

    let rows = [];
    try {
      rows = await withReadRetry(
        async () => {
          const { data, error } = await supabase.service.from('announcements').select('*');
          if (error) {
            if (isTransientUpstreamError(error)) throw error;
            console.error('[announcements] public query failed:', describeUpstreamError(error));
            throw httpError(502, 'Unable to load announcements. Please try again later.');
          }
          return data ?? [];
        },
        { label: 'announcements' }
      );
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error('[announcements] public query failed after retries:', describeUpstreamError(err));
      throw httpError(502, 'Unable to load announcements. Please try again later.');
    }

    const visible = (rows ?? []).filter((r) => {
      if (r.status === 'ARCHIVED') return false;
      const startsAt = new Date(r.starts_at ?? r.published_at ?? 0).getTime();
      if (Number.isFinite(startsAt) && startsAt > now) return false; // not live yet
      if (r.ends_at) {
        const endsAt = new Date(r.ends_at).getTime();
        if (Number.isFinite(endsAt) && endsAt < now) return false; // window closed
      }
      const audience = r.audience ?? 'ALL';
      if (!profile) return audience === 'ALL';
      if (profile.role === 'ADMIN') return true;
      if (isSeller(profile)) return audience === 'ALL' || audience === 'SELLERS';
      return audience === 'ALL' || audience === 'CUSTOMERS';
    });

    const announcements = await shapeAnnouncements(
      supabase,
      visible.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    );
    return ok(res, { announcements });
  });

  // ── POST /admin/announcements ────────────────────────────────────────────
  router.post(
    '/admin/announcements',
    requireAuth(supabase, env),
    requireRole(supabase, env, 'ADMIN'),
    async (req, res) => {
      const profile = req.auth.profile;
      const result = validate(req.body ?? {}, CREATE_SCHEMA);
      if (!result.ok) {
        const first = Object.values(result.errors)[0];
        throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
      }
      const f = result.fields;
      const startsAt = optionalIso(f.startDate, 'Start date');
      const endsAt = optionalIso(f.endDate, 'End date');
      if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
        throw httpError(400, 'End date must be after the start date.');
      }

      const status = f.status ?? 'ACTIVE';
      const nowIso = new Date().toISOString();
      const effectiveStart = startsAt ?? (status === 'ACTIVE' ? nowIso : null);
      const id = crypto.randomUUID();

      const { error: insertError } = await supabase.service.from('announcements').insert({
        id,
        title: f.title,
        body: f.message,
        audience: FRONTEND_TO_DB_AUDIENCE[f.audience ?? 'ALL'] ?? 'ALL',
        priority: f.priority ?? 'NORMAL',
        status,
        starts_at: effectiveStart,
        ends_at: endsAt,
        published_at: status === 'ACTIVE' ? effectiveStart ?? nowIso : null,
        created_by: profile.id,
        created_at: nowIso,
        updated_at: nowIso,
      });
      if (insertError) {
        // eslint-disable-next-line no-console
        console.error('[announcements] create failed:', insertError.message);
        throw httpError(502, 'Unable to create the announcement. Please try again.');
      }

      await writeAudit(supabase, {
        actorId: profile.id,
        actorRole: profile.role,
        action: 'announcement.created',
        resourceType: 'announcement',
        resourceId: id,
        ip: req.ip ?? null,
        metadata: { audience: f.audience ?? 'ALL', status },
      });

      const { data: saved = [] } = await supabase.service
        .from('announcements')
        .select('*')
        .eq('id', id);
      const announcement = (await shapeAnnouncements(supabase, saved))[0];
      return ok(res, { announcement });
    },
  );

  // ── PUT /admin/announcements/:id ─────────────────────────────────────────
  router.put(
    '/admin/announcements/:id',
    requireAuth(supabase, env),
    requireRole(supabase, env, 'ADMIN'),
    async (req, res) => {
      const profile = req.auth.profile;
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Announcement not found.');

      const result = validate(req.body ?? {}, UPDATE_SCHEMA); // per-field optional
      if (!result.ok) {
        const first = Object.values(result.errors)[0];
        throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
      }
      const f = result.fields;

      const { data: existingRows = [], error: readError } = await supabase.service
        .from('announcements')
        .select('*')
        .eq('id', id);
      if (readError) {
        // eslint-disable-next-line no-console
        console.error('[announcements] update read failed:', readError.message);
        throw httpError(502, 'Unable to update the announcement. Please try again.');
      }
      const existing = existingRows[0];
      if (!existing) throw httpError(404, 'Announcement not found.');

      const startsAt = f.startDate !== undefined ? optionalIso(f.startDate, 'Start date') : existing.starts_at;
      if (f.endDate !== undefined) {
        const endsAt = optionalIso(f.endDate, 'End date');
        if (endsAt && startsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
          throw httpError(400, 'End date must be after the start date.');
        }
      }
      const status = f.status ?? existing.status ?? 'ACTIVE';
      const nowIso = new Date().toISOString();
      const patch = { updated_at: nowIso };
      if (f.title !== undefined) patch.title = f.title;
      if (f.message !== undefined) patch.body = f.message;
      if (f.audience !== undefined) patch.audience = FRONTEND_TO_DB_AUDIENCE[f.audience] ?? 'ALL';
      if (f.priority !== undefined) patch.priority = f.priority;
      patch.status = status;
      patch.starts_at = startsAt;
      if (f.endDate !== undefined) patch.ends_at = optionalIso(f.endDate, 'End date');
      if (status === 'ACTIVE') {
        patch.published_at = existing.published_at ?? startsAt ?? nowIso;
        patch.starts_at = startsAt ?? patch.published_at;
      } else if (existing.published_at && status === 'ARCHIVED') {
        patch.published_at = existing.published_at; // keep the historical record
      }

      const { error: updateError } = await supabase.service
        .from('announcements')
        .update(patch)
        .eq('id', id);
      if (updateError) {
        // eslint-disable-next-line no-console
        console.error('[announcements] update failed:', updateError.message);
        throw httpError(502, 'Unable to update the announcement. Please try again.');
      }

      await writeAudit(supabase, {
        actorId: profile.id,
        actorRole: profile.role,
        action: 'announcement.updated',
        resourceType: 'announcement',
        resourceId: id,
        ip: req.ip ?? null,
        metadata: {},
      });

      const { data: saved = [] } = await supabase.service
        .from('announcements')
        .select('*')
        .eq('id', id);
      const announcement = (await shapeAnnouncements(supabase, saved))[0];
      return ok(res, { announcement });
    },
  );

  // ── DELETE /admin/announcements/:id ──────────────────────────────────────
  router.delete(
    '/admin/announcements/:id',
    requireAuth(supabase, env),
    requireRole(supabase, env, 'ADMIN'),
    async (req, res) => {
      const profile = req.auth.profile;
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Announcement not found.');

      const { data: existingRows = [], error: readError } = await supabase.service
        .from('announcements')
        .select('*')
        .eq('id', id);
      if (readError) {
        // eslint-disable-next-line no-console
        console.error('[announcements] delete read failed:', readError.message);
        throw httpError(502, 'Unable to delete the announcement. Please try again.');
      }
      if (!existingRows.length) throw httpError(404, 'Announcement not found.');

      const { error: deleteError } = await supabase.service
        .from('announcements')
        .delete()
        .eq('id', id);
      if (deleteError) {
        // eslint-disable-next-line no-console
        console.error('[announcements] delete failed:', deleteError.message);
        throw httpError(502, 'Unable to delete the announcement. Please try again.');
      }

      await writeAudit(supabase, {
        actorId: profile.id,
        actorRole: profile.role,
        action: 'announcement.deleted',
        resourceType: 'announcement',
        resourceId: id,
        ip: req.ip ?? null,
        metadata: {},
      });

      return ok(res, { success: true });
    },
  );

  return router;
}