import React, { useState, useEffect } from 'react';
import { adminService } from '../../services/adminService';
import type { AdminMetrics } from '../../types/admin';
import { ErrorState } from '../../components/common/ErrorState';
import { Link } from 'react-router-dom';
import { formatINR } from '../../lib/currency';
import {
  ShoppingBag,
  Users,
  Store,
  Package,
  IndianRupee,
  RotateCcw,
  Landmark,
  Megaphone,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Archive,
  Database,
  RefreshCw,
  Table
} from 'lucide-react';
import { Button } from '../../components/common/Button';
import { exportToCsv } from '../../lib/csvExport';

export const AdminDashboardPage: React.FC = () => {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [isRefreshingExport, setIsRefreshingExport] = useState<boolean>(false);
  const [exportBannerMessage, setExportBannerMessage] = useState<string | null>(null);

  const loadMetrics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getMetrics();
      setMetrics(data);
    } catch (err: any) {
      if (err.status === 401 || err.message?.toLowerCase().includes('not signed in')) {
        window.location.href = `/admin/login?from=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      setError(err.message || 'Unable to load administrative dashboard metrics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <ErrorState
          title="Administrative Telemetry Failure"
          message={error}
          onRetry={loadMetrics}
          isRetrying={isLoading}
        />
      </div>
    );
  }

  if (isLoading || !metrics) {
    return (
      <div className="py-24 text-center text-xs text-stone-500">
        <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
        Auditing platform state & governance records...
      </div>
    );
  }

  const handleDownloadExcel = async () => {
    try {
      setIsExportingExcel(true);
      setExportBannerMessage('Preparing and downloading Master Excel workbook (.xlsx)...');
      await adminService.downloadExcelExport();
      setExportBannerMessage('Master Excel workbook downloaded successfully.');
      setTimeout(() => setExportBannerMessage(null), 4000);
    } catch (err: any) {
      setExportBannerMessage(`Excel download failed: ${err.message}`);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleDownloadZip = async () => {
    try {
      setIsExportingZip(true);
      setExportBannerMessage('Packaging and downloading all SQL tables as CSV ZIP archive (.zip)...');
      await adminService.downloadZipExport();
      setExportBannerMessage('CSV ZIP archive downloaded successfully.');
      setTimeout(() => setExportBannerMessage(null), 4000);
    } catch (err: any) {
      setExportBannerMessage(`ZIP download failed: ${err.message}`);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleGenerateFreshExport = async () => {
    try {
      setIsRefreshingExport(true);
      setExportBannerMessage('Regenerating live export across all 20 database tables...');
      const res = await adminService.generateFreshExport();
      setExportBannerMessage(`Fresh export generated! ${res.result.tableCount} tables, ${res.result.totalRecords} total records synchronized.`);
      setTimeout(() => setExportBannerMessage(null), 5000);
    } catch (err: any) {
      setExportBannerMessage(`Export generation failed: ${err.message}`);
    } finally {
      setIsRefreshingExport(false);
    }
  };

  const handleExportSummaryCsv = () => {
    if (!metrics) return;
    exportToCsv(
      'kshop_platform_executive_summary',
      [
        { header: 'Platform Metric Indicator', key: 'metric' },
        { header: 'Current Cumulative Value', key: 'value' },
        { header: 'Notes / Scope', key: 'notes' },
      ],
      [
        { metric: 'Total Gross Revenue (INR)', value: metrics.totalGrossRevenue, notes: 'Collected via COD delivery' },
        { metric: 'Total Orders Placed', value: metrics.totalOrders, notes: 'All customer requisitions' },
        { metric: 'Total Registered Customers', value: metrics.totalCustomers, notes: 'Campus patrons' },
        { metric: 'Total Registered Sellers', value: metrics.totalSellers, notes: 'Merchant stores & ateliers' },
        { metric: 'Total Catalog Products', value: metrics.totalProducts, notes: 'Published & pending items' },
        { metric: 'Pending Refund Disputes', value: metrics.pendingRefundsCount, notes: 'Under arbitration' },
        { metric: 'Pending Escrow Settlements', value: metrics.pendingSettlementsCount, notes: 'Day-8 maturation pipeline' },
        { metric: 'Active Bulletins & Announcements', value: metrics.activeAnnouncementsCount, notes: 'Live broadcasts' },
      ]
    );
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Platform Sovereign Governance
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Administrative Control Tower
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Executive oversight, commercial telemetry, dispute tribunals, and escrow settlement status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadZip}
            isLoading={isExportingZip}
            leftIcon={<Archive className="w-4 h-4 text-burgundy" />}
          >
            Download CSVs (.ZIP)
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleDownloadExcel}
            isLoading={isExportingExcel}
            leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
          >
            Download Master Excel (.XLSX)
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportSummaryCsv}
            leftIcon={<Download className="w-4 h-4 text-stone-600" />}
          >
            Summary CSV
          </Button>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
            <CheckCircle2 className="w-4 h-4" /> Platform COD Protocol Nominal
          </span>
        </div>
      </div>

      {exportBannerMessage && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-medium text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-amber-700" />
            <span>{exportBannerMessage}</span>
          </div>
          <button
            onClick={() => setExportBannerMessage(null)}
            className="text-amber-700 hover:text-amber-900 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Overview Cards Required by prompt:
          Total Orders, Total Customers, Total Sellers, Total Products, Total Revenue, Pending Refunds, Pending Settlements */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Total Gross Revenue</span>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {formatINR(metrics.totalGrossRevenue)}
          </p>
          <span className="text-[10px] text-stone-400">All collected via white-glove COD</span>
        </div>

        {/* Total Orders */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Total Requisitions</span>
            <ShoppingBag className="w-4 h-4 text-burgundy" />
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">{metrics.totalOrders}</p>
          <Link to="/admin/orders" className="text-[11px] text-burgundy hover:underline">
            Manage orders →
          </Link>
        </div>

        {/* Total Customers */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Registered Patrons</span>
            <Users className="w-4 h-4 text-stone-600" />
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">{metrics.totalCustomers}</p>
          <Link to="/admin/customers" className="text-[11px] text-burgundy hover:underline">
            View customer registry →
          </Link>
        </div>

        {/* Total Sellers */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Accredited Ateliers</span>
            <Store className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">{metrics.totalSellers}</p>
          <Link to="/admin/sellers" className="text-[11px] text-burgundy hover:underline">
            Review seller applications →
          </Link>
        </div>

        {/* Total Products */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Indexed Artifacts</span>
            <Package className="w-4 h-4 text-stone-600" />
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">{metrics.totalProducts}</p>
          <Link to="/admin/products" className="text-[11px] text-burgundy hover:underline">
            Browse product matrix →
          </Link>
        </div>

        {/* Pending Refunds (Alert) */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Pending Refund Claims</span>
            <RotateCcw className="w-4 h-4 text-rosered-600" />
          </div>
          <p className="text-2xl font-serif font-bold text-rosered-600">
            {metrics.pendingRefundsCount}
          </p>
          <Link to="/admin/refunds" className="text-[11px] font-semibold text-rosered-700 hover:underline">
            Arbitrate disputes →
          </Link>
        </div>

        {/* Pending Settlements */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Pending Escrow Settlements</span>
            <Landmark className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-serif font-bold text-amber-700">
            {metrics.pendingSettlementsCount} batches
          </p>
          <Link to="/admin/settlements" className="text-[11px] text-burgundy hover:underline">
            Authorize bank wires →
          </Link>
        </div>

        {/* Active Announcements */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-soft space-y-1">
          <div className="flex items-center justify-between text-stone-500 text-xs">
            <span>Active Announcements</span>
            <Megaphone className="w-4 h-4 text-burgundy" />
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {metrics.activeAnnouncementsCount}
          </p>
          <Link to="/admin/announcements" className="text-[11px] text-burgundy hover:underline">
            Broadcast messages →
          </Link>
        </div>
      </div>

      {/* Enterprise Database & Ledger Exports Section */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-burgundy" />
              <h2 className="font-serif font-bold text-lg text-stone-900">
                PostgreSQL Schema & Comprehensive Ledger Export Suite
              </h2>
            </div>
            <p className="text-xs text-stone-500">
              Direct live data extraction from production Supabase database. Includes formatted multi-sheet Excel workbook and 21 individual CSV exports with synchronized 5% platform fee accounting.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateFreshExport}
              isLoading={isRefreshingExport}
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 text-stone-600 ${isRefreshingExport ? 'animate-spin' : ''}`} />}
            >
              Regenerate Fresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadZip}
              isLoading={isExportingZip}
              leftIcon={<Archive className="w-4 h-4 text-burgundy" />}
            >
              CSVs (.ZIP)
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadExcel}
              isLoading={isExportingExcel}
              leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
            >
              Master Excel (.XLSX)
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/70 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-stone-900">
              <Table className="w-4 h-4 text-emerald-600" />
              <span>Multi-Sheet Workbook</span>
            </div>
            <p className="text-stone-500 text-[11px]">
              22 auto-filtered worksheets covering Executive Dashboard, Products, Orders, Settlements, Treasury Ledger, and Commission Reconciliation.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/70 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-stone-900">
              <Archive className="w-4 h-4 text-burgundy" />
              <span>21 Clean CSV Tables</span>
            </div>
            <p className="text-stone-500 text-[11px]">
              Consolidated ZIP archive containing individual comma-separated files for every PostgreSQL schema table.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/70 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-stone-900">
              <IndianRupee className="w-4 h-4 text-amber-600" />
              <span>5% Commission Audited</span>
            </div>
            <p className="text-stone-500 text-[11px]">
              Strict mathematical reconciliation: Gross COD collection, 5% admin retained fee, and 95% net seller wire settlement.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/70 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-stone-900">
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
              <span>Security Redaction</span>
            </div>
            <p className="text-stone-500 text-[11px]">
              Passcode hashes and authentication secrets are safely redacted to preserve complete platform security compliance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
