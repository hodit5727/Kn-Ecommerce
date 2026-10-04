export type AnnouncementAudience = 'ALL' | 'ALL_CUSTOMERS' | 'ALL_SELLERS';
export type AnnouncementPriority = 'NORMAL' | 'HIGH' | 'URGENT';
export type AnnouncementStatus = 'ACTIVE' | 'SCHEDULED' | 'ARCHIVED';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  priority: AnnouncementPriority;
  startDate: string;
  endDate: string;
  status: AnnouncementStatus;
  createdBy: string;
  createdAt: string;
}
