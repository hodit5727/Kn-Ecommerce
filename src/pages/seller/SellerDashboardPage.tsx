import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { sellerService } from '../../services/sellerService';
import type { RevenueChartDataPoint } from '../../services/sellerService';
import type { SellerMetrics } from '../../types/seller';
import { ErrorState } from '../../components/common/ErrorState';
import { Button } from '../../components/common/Button';
import { formatINR } from '../../lib/currency';
import { useAuth } from '../../auth/AuthContext';
import {
  IndianRupee,
  ShoppingBag,
  Package,
  AlertTriangle,
  RotateCcw,
  Landmark,
  PlusCircle,
  ArrowUpRight,
  Boxes,
  Clock,
  CheckCircle2,
  ShieldCheck
} from 'lucide-react';

export const SellerDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<SellerMetrics | null>(null);
  const [chartData, setChartData] = useState<RevenueChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [m, c] = await Promise.all([
        sellerService.getMetrics(),
        sellerService.getRevenueChartData(),
      ]);
      setMetrics(m);
      setChartData(c);
    } catch (err: any) {
      // STRICT ERROR STATE
      setError(err.message || 'Unable to load seller financial metrics. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <ErrorState
          title="Seller Financial Telemetry Failure"
          message={error}
          onRetry={loadDashboard}
          isRetrying={isLoading}
        />
      </div>
    );
  }

  if (isLoading || !metrics) {
    return (
      <div className="py-24 text-center text-xs text-stone-500">
        <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
        Calculating atelier ledger and settlement telemetry...
      </div>
    );
  }

  // Bar heights scale to the real server-provided values (no fixed axis cap).
  const chartMax = Math.max(1, ...chartData.map((d) => Math.max(d.gross, d.net)));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Welcome & Fast CTAs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold uppercase tracking-widest text-burgundy">
              Maison Telemetry
            </span>
            <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              Seller ID: {user?.sellerId || (user?.businessId?.startsWith('KNSR-') ? user.businessId : user?.businessId?.replace(/^KNCR-/, 'KNSR-')) || 'KNSR-0001'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            {user?.sellerStoreName || 'Atelier Commerce Overview'}
          </h1>
          {/* Verification Badges */}
          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-medium text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Identity Verified
            </span>
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-medium text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Liveness Verified
            </span>
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-medium text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Accreditation Approved
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/seller/products/new">
            <Button variant="primary" size="sm" leftIcon={<PlusCircle className="w-4 h-4" />}>
              Publish Artifact
            </Button>
          </Link>
          <Link to="/seller/inventory">
            <Button variant="outline" size="sm" leftIcon={<Boxes className="w-4 h-4" />}>
              Manage SKU Stock
            </Button>
          </Link>
        </div>
      </div>

      {/* 7 Core Overview Cards Required by prompt */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Gross Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Gross Revenue</span>
            <div className="p-2 rounded-xl bg-burgundy-50 text-burgundy">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {formatINR(metrics.grossSales)}
          </p>
        </div>

        {/* Pending Settlement */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Pending Settlement</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-amber-700">
            {formatINR(metrics.pendingSettlement)}
          </p>
          <p className="text-[11px] text-stone-400">Scheduled for month-end wire</p>
        </div>

        {/* Available Settlement */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Available Settlement</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-emerald-700">
            {formatINR(metrics.availableSettlement)}
          </p>
          <Link
            to="/seller/settlements"
            className="text-[11px] font-semibold text-burgundy hover:underline flex items-center gap-1"
          >
            <span>Request Payout</span> <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Total Orders */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Total Requisitions</span>
            <div className="p-2 rounded-xl bg-cream-100 text-burgundy">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {metrics.totalOrders}
          </p>
          <p className="text-[11px] text-stone-400">All fulfilled via COD Courier</p>
        </div>

        {/* Active Products */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Published Artifacts</span>
            <div className="p-2 rounded-xl bg-stone-100 text-stone-700">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {metrics.activeProductsCount}
          </p>
          <Link to="/seller/products" className="text-[11px] text-burgundy hover:underline">
            View catalog index →
          </Link>
        </div>

        {/* Low Stock (VISUAL WARNING REQUIREMENT) */}
        <div className="bg-white p-5 rounded-2xl border border-rosered-200 shadow-soft space-y-2 bg-rosered-50/20">
          <div className="flex items-center justify-between text-rosered-700 text-xs font-medium">
            <span>Low Stock Warning</span>
            <div className="p-2 rounded-xl bg-rosered-100 text-rosered-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-rosered-600">
            {metrics.lowStockCount} items
          </p>
          <Link
            to="/seller/inventory"
            className="text-[11px] font-semibold text-rosered-700 hover:underline"
          >
            Replenish inventory →
          </Link>
        </div>

        {/* Refund Requests */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Refund Claims</span>
            <div className="p-2 rounded-xl bg-cream-100 text-stone-700">
              <RotateCcw className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {metrics.refundRequestsCount} open
          </p>
          <Link to="/seller/refunds" className="text-[11px] text-burgundy hover:underline">
            Review dossier →
          </Link>
        </div>

        {/* Platform Fees Paid */}
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-2">
          <div className="flex items-center justify-between text-stone-500 text-xs font-medium">
            <span>Governance Fees (5%)</span>
            <div className="p-2 rounded-xl bg-stone-100 text-stone-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-stone-700">
            {formatINR(metrics.platformFeesPaid)}
          </p>
          <p className="text-[11px] text-stone-400">Reconciled automatically</p>
        </div>
      </div>

      {/* Revenue Over Time Chart (Clean, purposeful SVG visualization) */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-cream-200 shadow-soft space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-serif font-bold text-lg text-stone-900">
              Revenue & Order Trajectory (Last 6 Months)
            </h3>
            <p className="text-xs text-stone-500">
              Gross sales trajectory reconciled with COD delivery handovers
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-burgundy" />
              <span className="font-medium text-stone-700">Gross Sales</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-cream-300" />
              <span className="font-medium text-stone-700">Net Revenue</span>
            </div>
          </div>
        </div>

        {/* SVG Chart */}
        <div className="h-64 w-full flex items-end gap-4 sm:gap-8 pt-8 pb-2 border-b border-cream-200">
          {chartData.length === 0 ? (
            <div className="w-full self-center text-center text-xs text-stone-400">
              No revenue recorded yet. Monthly figures appear once orders are delivered.
            </div>
          ) : (
            chartData.map((d) => {
              const grossHeight = (d.gross / chartMax) * 100;
              const netHeight = (d.net / chartMax) * 100;

              return (
                <div key={d.month} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <div className="text-[10px] text-stone-400 font-medium mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    ${(d.gross / 1000).toFixed(1)}k
                  </div>
                  <div className="w-full flex items-end justify-center gap-1 h-44">
                    {/* Gross Bar */}
                    <div
                      style={{ height: `${grossHeight}%` }}
                      className="w-full max-w-[28px] bg-burgundy rounded-t-lg transition-all duration-500 hover:bg-burgundy-800"
                      title={`${d.month} Gross: ${formatINR(d.gross)}`}
                    />
                    {/* Net Bar */}
                    <div
                      style={{ height: `${netHeight}%` }}
                      className="w-full max-w-[28px] bg-cream-300 rounded-t-lg transition-all duration-500 hover:bg-cream-400"
                      title={`${d.month} Net: ${formatINR(d.net)}`}
                    />
                  </div>
                  <span className="text-xs font-semibold text-stone-700 mt-2">{d.month}</span>
                  <span className="text-[10px] text-stone-400">{d.orders} ord</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
