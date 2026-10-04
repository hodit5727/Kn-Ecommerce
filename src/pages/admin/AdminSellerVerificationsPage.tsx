import React, { useState, useEffect, useCallback } from 'react';
import { adminVerificationService } from '../../services/adminVerificationService';
import type { AdminVerificationRow } from '../../types/verification';
import { ErrorState } from '../../components/common/ErrorState';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';
import { ScanFace, FileSearch, CheckCircle2, XCircle, RotateCcw, ExternalLink, ShieldCheck, Download } from 'lucide-react';
import { exportToCsv } from '../../lib/csvExport';

/**
 * Admin reviewer surface for the seller identity + face verification (KYC)
 * pipeline. Every action is a REAL backend call and only succeeds when the
 * server (admin role + business rules + DB checks) confirms it.
 *
 * - MANUAL_REVIEW: doc WAS ambiguous / face match was borderline — the
 *   reviewer inspects the private ID document (short-lived signed URL) and
 *   Approves (backend requires a real stored score), Rejects (with reason),
 *   or Re-opens the applicant (fresh attempt cycle).
 * - REJECTED: reviewer may request a re-verification (new cycle).
 * - VERIFIED / REVERIFICATION_REQUIRED: read-only at this surface.
 */
type ReviewModalKind = null | 'reject' | 'reverify';

const STATE_BADGE: Record<string, { variant: 'emerald' | 'amber' | 'rosered' | 'burgundy' | 'stone'; label: string }> = {
  VERIFIED: { variant: 'emerald', label: 'VERIFIED' },
  MANUAL_REVIEW: { variant: 'amber', label: 'MANUAL REVIEW' },
  REJECTED: { variant: 'rosered', label: 'REJECTED' },
  REVERIFICATION_REQUIRED: { variant: 'burgundy', label: 'RE-VERIFY REQUIRED' },
};

function verdictBadge(status: string | null): { variant: 'emerald' | 'amber' | 'rosered' | 'stone'; label: string } {
  if (status === 'PASSED') return { variant: 'emerald', label: 'Passed' };
  if (status === 'FAILED') return { variant: 'rosered', label: 'Failed' };
  if (status === 'NEEDS_REVIEW') return { variant: 'amber', label: 'Needs review' };
  return { variant: 'stone', label: 'Pending' };
}

export const AdminSellerVerificationsPage: React.FC = () => {
  const [rows, setRows] = useState<AdminVerificationRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: ReviewModalKind; row: AdminVerificationRow } | null>(null);
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const { showToast } = useToast();

  const loadVerifications = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await adminVerificationService.list();
      setRows(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load seller verifications.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVerifications();
  }, [loadVerifications]);

  const openDocument = async (row: AdminVerificationRow) => {
    setBusyId(row.id);
    try {
      const url = row.documentUrl ?? (await adminVerificationService.getDocumentUrl(row.id));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      showToast(err.message || 'Unable to open the ID document.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (row: AdminVerificationRow) => {
    setBusyId(row.id);
    try {
      const res = await adminVerificationService.approve(row.id);
      showToast(`Accreditation granted! Seller ID: ${res.sellerId || 'KNSR-XXXX'} issued.`);
      await loadVerifications();
    } catch (err: any) {
      showToast(err.message || 'Approval failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openModal = (kind: 'reject' | 'reverify', row: AdminVerificationRow) => {
    setModal({ kind, row });
    setReason('');
  };

  const submitModal = async () => {
    if (!modal) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      showToast('Enter a reason (3–500 characters).', 'error');
      return;
    }
    setIsSubmitting(true);
    setBusyId(modal.row.id);
    try {
      if (modal.kind === 'reject') {
        await adminVerificationService.reject(modal.row.id, trimmed);
        showToast('Verification rejected — applicant notified to re-apply.');
      } else {
        await adminVerificationService.requestReverification(modal.row.id, trimmed);
        showToast('Re-verification requested — applicant can start a fresh attempt.');
      }
      setModal(null);
      await loadVerifications();
    } catch (err: any) {
      showToast(err.message || 'Action failed.', 'error');
    } finally {
      setIsSubmitting(false);
      setBusyId(null);
    }
  };

  const handleExportCsv = () => {
    if (rows.length === 0) {
      showToast('No verification records to export.', 'error');
      return;
    }
    exportToCsv<AdminVerificationRow>(
      'kshop_seller_verifications',
      [
        { header: 'Verification ID', key: 'id' },
        { header: 'User ID', key: 'userId' },
        { header: 'Applicant Email', key: (r) => r.email || 'N/A' },
        { header: 'Store Name', key: (r) => r.storeName || 'N/A' },
        { header: 'Verification State', key: 'state' },
        { header: 'Attempt Cycle', key: 'cycle' },
        { header: 'Document Status', key: (r) => r.documentStatus || 'N/A' },
        { header: 'Liveness Status', key: (r) => r.livenessStatus || 'N/A' },
        { header: 'Face Match Status', key: (r) => r.matchStatus || 'N/A' },
        { header: 'Attempt Count', key: (r) => r.attemptCount ?? 0 },
        { header: 'Submitted At', key: (r) => r.submittedAt ? new Date(r.submittedAt).toLocaleString() : 'N/A' },
        { header: 'Reviewed At', key: (r) => r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : 'Pending' },
        { header: 'Rejection Reason', key: (r) => r.rejectionReason || 'None' },
      ],
      rows
    );
    showToast(`Exported ${rows.length} KYC verification records to CSV!`);
  };

  const empty = !isLoading && !error && rows.length === 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Seller Identity & Face Verification
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            KYC Review Console
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Reviewed by a server-verified admin. Verdicts are backend + database enforced.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isLoading || rows.length === 0}
            leftIcon={<Download className="w-4 h-4 text-emerald-600" />}
          >
            Export Verifications CSV
          </Button>
          <div className="hidden sm:flex w-10 h-10 rounded-2xl bg-burgundy-50 text-burgundy items-center justify-center shrink-0">
            <ScanFace className="w-5 h-5" />
          </div>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadVerifications} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Loading verification dossiers...</div>
      ) : empty ? (
        <div className="py-16 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200">
          No seller verifications yet. When sellers complete identity checks, they appear here.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const badge = STATE_BADGE[row.state] ?? { variant: 'stone' as const, label: row.state.replace(/_/g, ' ') };
            const doc = verdictBadge(row.documentStatus);
            const match = verdictBadge(row.matchStatus);
            const actionable = row.state === 'MANUAL_REVIEW' || row.state === 'REJECTED';
            const hasDoc = row.documentStatus !== 'PENDING' || Boolean(row.documentUrl);
            return (
              <div
                key={row.id}
                className="bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-cream-100 text-burgundy flex items-center justify-center font-serif font-bold text-lg">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-serif font-bold text-base text-stone-900">
                          {row.storeName ? `${row.storeName} — ${row.sellerName || row.email}` : (row.email ?? 'Unidentified applicant')}
                        </h3>
                        {row.sellerId && (
                          <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300">
                            Seller ID: {row.sellerId}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500">
                        Email: {row.email} · Cycle {row.cycle} · {row.attemptCount} attempt{row.attemptCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant} size="sm" dot>
                      {badge.label}
                    </Badge>
                    {hasDoc && (
                      <Button variant="outline" size="sm" onClick={() => openDocument(row)} isLoading={busyId === row.id && !row.documentUrl} leftIcon={<FileSearch className="w-4 h-4" />}>
                        View ID Document
                      </Button>
                    )}
                    {row.state === 'MANUAL_REVIEW' && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => handleApprove(row)} isLoading={busyId === row.id} leftIcon={<CheckCircle2 className="w-4 h-4" />}>
                          Grant Accreditation
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => openModal('reject', row)} leftIcon={<XCircle className="w-4 h-4" />}>
                          Reject
                        </Button>
                      </>
                    )}
                    {actionable && (
                      <Button variant="secondary" size="sm" onClick={() => openModal('reverify', row)} leftIcon={<RotateCcw className="w-4 h-4" />}>
                        Request Re-verification
                      </Button>
                    )}
                  </div>
                </div>

                {/* Verdict summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">ID Document Verdict</span>
                    <span className="mt-1 inline-block">
                      <Badge variant={doc.variant} size="sm">{doc.label}</Badge>
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Live Liveness Check</span>
                    <span className="mt-1 inline-block">
                      <Badge variant={row.livenessStatus === 'PASSED' ? 'emerald' : 'stone'} size="sm">
                        {row.livenessStatus === 'PASSED' ? 'Passed (Single Blink)' : (row.livenessStatus || 'Pending')}
                      </Badge>
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Face Match Alignment</span>
                    <span className="mt-1 inline-block">
                      <Badge variant={match.variant} size="sm">{match.label}</Badge>
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Review & Accreditation</span>
                    <span className="font-semibold text-stone-800">
                      {row.reviewStatus === 'NONE' ? 'Not reviewed' : `${row.reviewStatus}${row.reviewedAt ? ` · ${new Date(row.reviewedAt).toLocaleDateString()}` : ''}`}
                    </span>
                    {row.rejectionReason && (
                      <span className="block text-[11px] text-rosered-700 mt-1">{row.rejectionReason}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reason modal (reject / request re-verification) */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cream-100 text-burgundy flex items-center justify-center">
                {modal.kind === 'reject' ? <XCircle className="w-5 h-5" /> : <RotateCcw className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-serif font-bold text-stone-900">
                  {modal.kind === 'reject' ? 'Reject Verification' : 'Request Re-verification'}
                </h3>
                <p className="text-xs text-stone-500">
                  {modal.row.email ?? 'Applicant'} · Cycle {modal.row.cycle}
                </p>
              </div>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder={
                modal.kind === 'reject'
                  ? 'Reason for rejection — shown to the applicant (3–500 chars)'
                  : 'Note for the applicant — why a fresh attempt is needed (3–500 chars)'
              }
              className="w-full rounded-xl border border-stone-200 p-3 text-sm outline-none focus:ring-2 focus:ring-burgundy"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setModal(null)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                variant={modal.kind === 'reject' ? 'destructive' : 'primary'}
                size="sm"
                onClick={submitModal}
                isLoading={isSubmitting}
              >
                {modal.kind === 'reject' ? 'Reject Verification' : 'Request Re-verification'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-stone-400">
        <ExternalLink className="w-3 h-3" />
        ID documents open via short-lived signed URLs from the private bucket — never public links.
      </div>
    </div>
  );
};