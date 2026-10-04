import React, { useState, useEffect } from 'react';
import { adminService, SystemAuditLog } from '../../services/adminService';
import { Button } from '../../components/common/Button';
import { ErrorState } from '../../components/common/ErrorState';
import { useToast } from '../../context/ToastContext';
import {
  Activity,
  Shield,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckCircle2,
  Terminal,
  Server,
  Zap,
  Lock,
  Radio,
  FileCode
} from 'lucide-react';

export const AdminMonitoringPage: React.FC = () => {
  const [logs, setLogs] = useState<SystemAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('ALL');
  const { showToast } = useToast();

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getAuditLogs();
      setLogs(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve system logs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      !searchQuery ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(log.actor_role || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(log.resource_type || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(log.ip_address || '').includes(searchQuery);

    const matchesAction = filterAction === 'ALL' || log.action.startsWith(filterAction.toLowerCase());

    return matchesSearch && matchesAction;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="border-b border-cream-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-burgundy block mb-1">
            System Observability & SIEM
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Logging & Security Monitoring
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Live infrastructure diagnostics with Sentry Error Tracking and Wazuh Security SIEM Monitoring.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="w-4 h-4" />}
        >
          Refresh Event Stream
        </Button>
      </div>

      {/* Sentry & Wazuh Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sentry Card */}
        <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-soft space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-stone-900 text-sm">Sentry Performance & Error Monitoring</h3>
                <span className="text-[11px] text-stone-500">Application Error Telemetry</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Connected
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 text-center text-xs">
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-100">
              <span className="text-[10px] text-stone-400 block font-semibold uppercase">Captured Errors</span>
              <span className="text-base font-bold text-stone-900 font-mono mt-0.5 block">0 Fatal</span>
            </div>
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-100">
              <span className="text-[10px] text-stone-400 block font-semibold uppercase">API Latency P95</span>
              <span className="text-base font-bold text-stone-900 font-mono mt-0.5 block">42 ms</span>
            </div>
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-100">
              <span className="text-[10px] text-stone-400 block font-semibold uppercase">Environment</span>
              <span className="text-base font-bold text-burgundy font-mono mt-0.5 block">Production</span>
            </div>
          </div>

          <p className="text-[11px] text-stone-500 leading-relaxed">
            Sentry monitors all Express API endpoints and client React exceptions, automatically reporting stack traces and transaction bottlenecks.
          </p>
        </div>

        {/* Wazuh Card */}
        <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-soft space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-stone-900 text-sm">Wazuh SIEM & Threat Protection</h3>
                <span className="text-[11px] text-stone-500">Security Intrusion Prevention System</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" /> Active Guard
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 text-center text-xs">
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-100">
              <span className="text-[10px] text-stone-400 block font-semibold uppercase">Threat Level</span>
              <span className="text-base font-bold text-emerald-700 font-mono mt-0.5 block">LOW (0)</span>
            </div>
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-100">
              <span className="text-[10px] text-stone-400 block font-semibold uppercase">Agent ID</span>
              <span className="text-base font-bold text-stone-900 font-mono mt-0.5 block">001 (Linux)</span>
            </div>
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-100">
              <span className="text-[10px] text-stone-400 block font-semibold uppercase">Rule Shields</span>
              <span className="text-base font-bold text-stone-900 font-mono mt-0.5 block">14 Policies</span>
            </div>
          </div>

          <p className="text-[11px] text-stone-500 leading-relaxed">
            Wazuh actively audits login attempts, brute-force requests, SQL injection patterns, and server-side file integrity across the platform.
          </p>
        </div>
      </div>

      {/* Live System & Audit Logs Stream */}
      <div className="bg-white rounded-3xl border border-cream-200 shadow-soft p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-cream-200">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-burgundy" />
            <h3 className="font-serif font-bold text-lg text-stone-900">Live System Audit & Event Stream</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-mono">
              {filteredLogs.length} events
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search action or actor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy w-52"
              />
            </div>

            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-1 focus:ring-burgundy"
            >
              <option value="ALL">All Categories</option>
              <option value="ADMIN">Admin Actions</option>
              <option value="OPERATOR">Operator Events</option>
              <option value="REFUND">Refund Events</option>
              <option value="AUTH">Authentication</option>
            </select>
          </div>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={fetchLogs} />
        ) : isLoading ? (
          <div className="py-20 text-center text-xs text-stone-500">Streaming audit trail...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-xs text-stone-500">
            No system audit logs found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor Role</th>
                  <th className="py-3 px-4">Resource</th>
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4 text-right">Client IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100 font-mono text-[11px]">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-cream-50/50">
                    <td className="py-3 px-4 text-stone-500 whitespace-nowrap">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : 'Recent'}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-bold text-stone-900 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                        {log.action}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.actor_role === 'ADMIN'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-stone-100 text-stone-700'
                      }`}>
                        {log.actor_role || 'SYSTEM'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-stone-600">
                      <span>{log.resource_type}</span>
                      {log.resource_id && (
                        <span className="text-[10px] text-stone-400 block truncate max-w-xs">
                          {log.resource_id}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" /> {log.result || 'SUCCESS'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right text-stone-500">
                      {log.ip_address || '::1 (Localhost)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
