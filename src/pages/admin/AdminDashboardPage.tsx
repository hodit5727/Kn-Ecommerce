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
  Download
} from 'lucide-react';
import { Button } from '../../components/common/Button';
import { exportToCsv } from '../../lib/csvExport';

export const AdminDashboardPage: React.FC = () => {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getMetrics();
      setMetrics(data);
    } catch (err: any) {
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

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSummaryCsv}
            leftIcon={<Download className="w-4 h-4 text-emerald-600" />}
          >
            Export Executive Summary CSV
          </Button>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
            <CheckCircle2 className="w-4 h-4" /> Platform COD Protocol Nominal
          </span>
        </div>
      </div>

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
    </div>
  );
};
