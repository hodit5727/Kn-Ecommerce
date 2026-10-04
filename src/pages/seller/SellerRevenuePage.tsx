import React, { useState, useEffect } from 'react';
import { sellerService } from '../../services/sellerService';
import type { RevenueChartDataPoint } from '../../services/sellerService';
import type { SellerMetrics } from '../../types/seller';
import { ErrorState } from '../../components/common/ErrorState';
import { Calendar, CheckCircle2 } from 'lucide-react';
import { formatINR } from '../../lib/currency';

export const SellerRevenuePage: React.FC = () => {
  const [metrics, setMetrics] = useState<SellerMetrics | null>(null);
  const [chartData, setChartData] = useState<RevenueChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
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
      setError(err.message || 'Unable to aggregate revenue analytics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (error) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  if (isLoading || !metrics) {
    return <div className="py-20 text-center text-xs text-stone-500">Aggregating revenue logs...</div>;
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Financial Governance
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Seller Revenue & Payout Ledger
        </h1>
      </div>

      {/* Financial Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
          <span className="text-xs text-stone-500 font-medium">Gross COD Sales</span>
          <p className="text-2xl font-serif font-bold text-stone-900">
            {formatINR(metrics.grossSales)}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
          <span className="text-xs text-stone-500 font-medium">Platform Fees (5%)</span>
          <p className="text-2xl font-serif font-bold text-stone-600">
            {formatINR(metrics.platformFeesPaid)}
          </p>
          <span className="text-[10px] text-stone-400">Commission for curation & courier</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
          <span className="text-xs text-stone-500 font-medium">Net Earned Revenue</span>
          <p className="text-2xl font-serif font-bold text-burgundy">
            {formatINR(metrics.netRevenue)}
          </p>
          <span className="text-[10px] text-stone-500">Net after fees & settled returns</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
          <span className="text-xs text-stone-500 font-medium">Pending Wire Disbursement</span>
          <p className="text-2xl font-serif font-bold text-amber-600">
            {formatINR(metrics.pendingSettlement)}
          </p>
          <span className="text-[10px] text-stone-400">Disbursed on 1st & 16th</span>
        </div>
      </div>

      {/* Month by Month Revenue Breakdown Table */}
      {(() => {
        const activeChartData = chartData.filter((d) => (d.gross || 0) > 0 || (d.orders || 0) > 0);

        if (activeChartData.length === 0) {
          return (
            <div className="bg-white rounded-3xl border border-cream-200 shadow-soft p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto text-burgundy">
                <Calendar className="w-6 h-6" />
              </div>
              <h3 className="font-serif font-bold text-base sm:text-lg text-stone-900">
                No Revenue Generated Yet
              </h3>
              <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
                Monthly revenue records will automatically appear here once customer orders are delivered and cash on delivery settlements are processed.
              </p>
            </div>
          );
        }

        return (
          <div className="bg-white rounded-3xl border border-cream-200 shadow-soft p-6 sm:p-8 space-y-6">
            <h3 className="font-serif font-bold text-lg text-stone-900 pb-3 border-b border-cream-200 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-burgundy" /> Monthly Sales & Revenue Breakdown
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                    <th className="py-3 px-4">Month</th>
                    <th className="py-3 px-4">Delivered Orders</th>
                    <th className="py-3 px-4">Gross Sales</th>
                    <th className="py-3 px-4">Platform Fee (5%)</th>
                    <th className="py-3 px-4">Net Earnings</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100">
                  {activeChartData.map((d) => (
                    <tr key={d.month} className="hover:bg-cream-50/50">
                      <td className="py-3.5 px-4 font-semibold text-stone-900">{d.month}</td>
                      <td className="py-3.5 px-4 text-stone-600">{d.orders} orders</td>
                      <td className="py-3.5 px-4 font-bold text-stone-900">{formatINR(d.gross)}</td>
                      <td className="py-3.5 px-4 text-stone-500">{formatINR(d.gross - d.net)}</td>
                      <td className="py-3.5 px-4 font-bold text-burgundy">{formatINR(d.net)}</td>
                      <td className="py-3.5 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Settled
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
