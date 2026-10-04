import React, { useState, useEffect } from 'react';
import { announcementService } from '../../services/announcementService';
import type { Announcement, AnnouncementAudience, AnnouncementPriority } from '../../types/announcement';
import { useToast } from '../../context/ToastContext';
import { ErrorState } from '../../components/common/ErrorState';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { Megaphone, Trash2, Calendar, Users, Download } from 'lucide-react';
import { exportToCsv } from '../../lib/csvExport';

export const AdminAnnouncementsPage: React.FC = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('ALL');
  const [priority, setPriority] = useState<AnnouncementPriority>('NORMAL');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  const loadAnnouncements = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await announcementService.getAnnouncements();
      setAnnouncements(list);
    } catch (err: any) {
      setError(err.message || 'Unable to load announcements.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await announcementService.createAnnouncement({
        title,
        message,
        audience,
        priority,
        startDate,
        endDate,
        status: 'ACTIVE',
        // Server stamps the authenticated admin as createdBy; this value is
        // ignored server-side, so no client-side identity is ever asserted.
        createdBy: '',
      });
      showToast('Announcement broadcasted to target audience.');
      setTitle('');
      setMessage('');
      loadAnnouncements();
    } catch (err: any) {
      showToast(err.message || 'Broadcast failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await announcementService.deleteAnnouncement(id);
      showToast('Announcement archived.');
      loadAnnouncements();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete announcement.', 'error');
    }
  };

  const handleExportCsv = () => {
    if (announcements.length === 0) {
      showToast('No announcements to export.', 'error');
      return;
    }
    exportToCsv<Announcement>(
      'kshop_announcements',
      [
        { header: 'Announcement ID', key: 'id' },
        { header: 'Bulletin Title', key: 'title' },
        { header: 'Message Body', key: 'message' },
        { header: 'Target Audience', key: 'audience' },
        { header: 'Priority Level', key: 'priority' },
        { header: 'Broadcast Start Date', key: (a) => (a as any).startDate || (a as any).published_at || 'Immediate' },
        { header: 'Expiry Date', key: (a) => (a as any).endDate || (a as any).expires_at || 'Permanent' },
        { header: 'Created Date', key: (a) => (a as any).createdAt ? new Date((a as any).createdAt).toLocaleDateString() : 'N/A' },
      ],
      announcements
    );
    showToast(`Exported ${announcements.length} announcements to CSV!`);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Directives & Bulletins
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Announcement Management Engine
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Broadcast platform updates, campus alerts, maintenance notices, and seller policy changes.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={isLoading || announcements.length === 0}
          leftIcon={<Download className="w-4 h-4 text-emerald-600" />}
        >
          Export Bulletins CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form: Create Announcement */}
        <form
          onSubmit={handleCreate}
          className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-4"
        >
          <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-stone-200">
            <Megaphone className="w-4 h-4 text-burgundy" /> Broadcast Directives
          </h3>

          <Input
            label="Announcement Title"
            placeholder="e.g. Autumn Horology Courier Protocols"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div>
            <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
              Message Content
            </label>
            <textarea
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="State the directive, protocol change, or schedule adjustment..."
              className="w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-xs focus:ring-1 focus:ring-stone-900 text-stone-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Target Audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as any)}
              options={[
                { value: 'ALL', label: 'All Users (Customers & Sellers)' },
                { value: 'ALL_CUSTOMERS', label: 'Customers Only' },
                { value: 'ALL_SELLERS', label: 'Accredited Sellers Only' },
              ]}
            />
            <Select
              label="Priority Level"
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              options={[
                { value: 'NORMAL', label: 'Standard Normal' },
                { value: 'HIGH', label: 'High Priority' },
                { value: 'URGENT', label: 'Urgent Alert' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="Expiry Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isSubmitting}>
            Publish Announcement
          </Button>
        </form>

        {/* Right List: Active Announcements */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="font-serif font-bold text-base text-stone-900">
            Active Bulletins ({announcements.length})
          </h3>

          {error ? (
            <ErrorState message={error} onRetry={loadAnnouncements} isRetrying={isLoading} />
          ) : isLoading ? (
            <div className="py-12 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200 shadow-soft">
              Loading announcements...
            </div>
          ) : announcements.length === 0 ? (
            <div className="py-12 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200 shadow-soft">
              No announcements have been published yet.
            </div>
          ) : (
            announcements.map((anc) => (
              <div
                key={anc.id}
                className="bg-white p-6 rounded-3xl border border-stone-200 shadow-soft space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-serif font-bold text-sm text-stone-900">{anc.title}</span>
                      <Badge variant={anc.priority === 'URGENT' ? 'rosered' : 'amber'} size="sm">
                        {anc.priority}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-stone-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {anc.audience.replace(/_/g, ' ')}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Valid to {anc.endDate}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(anc.id)}
                    className="p-1.5 text-stone-400 hover:text-rosered-600 rounded-lg hover:bg-stone-50"
                    title="Archive bulletin"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-stone-600 leading-relaxed bg-stone-50 p-3.5 rounded-xl border border-stone-100">
                  {anc.message}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
