/**
 * Announcement service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/localStorage flow) ───────────────
 * - No localStorage, no SEED_ANNOUNCEMENTS, no simulateNetworkDelay, no
 *   devController failure toggles. Announcements live in the database.
 * - Admin CRUD is authorization-checked SERVER-SIDE: the
 *   /admin/announcements* endpoints require a server-verified ADMIN role
 *   (403 for customers/sellers/unauthenticated). `createdBy` is stamped from
 *   the authenticated session — any client-supplied value is ignored, so a
 *   user can never attribute an announcement to someone else.
 * - Read access is audience-scoped SERVER-SIDE: the server filters
 *   /announcements by the authenticated user's audience (a customer only
 *   sees ALL + ALL_CUSTOMERS, a seller only ALL + ALL_SELLERS, an admin
 *   sees everything). Client-supplied ids and audience values are never
 *   trusted for authorization.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /announcements                                   -> { announcements }
 *        server filters by the authenticated user's audience; the optional
 *        targetAudience client argument is ignored and not forwarded
 * POST   /admin/announcements     { ...fields }           -> { announcement }
 * PUT    /admin/announcements/:id { ...fields }           -> { announcement }
 * DELETE /admin/announcements/:id                         -> { success }
 *        (PUT/DELETE are ADMIN-only server-side; both respond with JSON —
 *         the client helper requires a JSON body on success)
 */
import type { Announcement, AnnouncementAudience } from '../types/announcement';
import { apiRequest } from '../api/http';

interface AnnouncementsResponse {
  announcements: Announcement[];
}

interface AnnouncementResponse {
  announcement: Announcement;
}

interface SuccessResponse {
  success: boolean;
}

export const announcementService = {
  async getAnnouncements(targetAudience?: AnnouncementAudience): Promise<Announcement[]> {
    // Deliberately ignored: the server scopes results by the session's role.
    void targetAudience;
    const res = await apiRequest<AnnouncementsResponse>('/announcements', { method: 'GET' });
    return res.announcements;
  },

  /** `createdBy` is required by the payload type but the server overwrites it
   *  with the authenticated admin's identity. */
  async createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt'>): Promise<Announcement> {
    const res = await apiRequest<AnnouncementResponse>('/admin/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.announcement;
  },

  async deleteAnnouncement(id: string): Promise<void> {
    await apiRequest<SuccessResponse>(`/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
