import React, { useState, useEffect, useCallback } from 'react';
import { adminService } from '../../services/adminService';
import { AdminCustomerRecord } from '../../types/admin';
import { ErrorState } from '../../components/common/ErrorState';
import { Badge } from '../../components/common/Badge';
import { Pagination } from '../../components/common/Pagination';
import { useToast } from '../../context/ToastContext';
import { Users, UserX, UserCheck, Search } from 'lucide-react';
import { formatINR } from '../../lib/currency';

const DEFAULT_PER_PAGE = 20;

export const AdminCustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<AdminCustomerRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const { showToast } = useToast();

  // Server-side search: debounce the input, then reset to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminService.getCustomers({ page, perPage, q: debouncedQuery });
      setCustomers(res.items);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages || 1);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve patron directory.');
    } finally {
      setIsLoading(false);
    }
  }, [page, perPage, debouncedQuery]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const handleToggleStatus = async (id: string, name: string) => {
    try {
      const updated = await adminService.toggleCustomerStatus(id);
      showToast(`Account status for ${name} set to ${updated.status}.`);
      loadCustomers();
    } catch (err: any) {
      showToast(err.message || 'Failed to update patron status.', 'error');
    }
  };

  const empty = !isLoading && !error && customers.length === 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
          Patron Registry
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Client & Patron Directory
        </h1>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-soft flex items-center gap-3">
        <Search className="w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or email (server-side)..."
          className="w-full text-xs bg-transparent focus:outline-none text-stone-900"
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadCustomers} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Accessing patron registry...</div>
      ) : empty ? (
        <div className="py-16 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200">
          {debouncedQuery
            ? `No patrons match "${debouncedQuery}".`
            : 'No patrons registered yet.'}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Customer ID</th>
                  <th className="py-4 px-4">Patron Full Name</th>
                  <th className="py-4 px-4">Direct Email</th>
                  <th className="py-4 px-4">Direct Contact</th>
                  <th className="py-4 px-4">Account Status</th>
                  <th className="py-4 px-4">Total Requisitions</th>
                  <th className="py-4 px-4">Cumulative Valuation</th>
                  <th className="py-4 px-4">Seller Status</th>
                  <th className="py-4 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50/50">
                    <td className="py-4 px-6">
                      <div className="font-mono font-bold text-stone-800 text-[11px]">
                        {c.customerId || '—'}
                      </div>
                      {c.sellerId && (
                        <div className="font-mono text-[10px] text-emerald-700 font-semibold mt-0.5">
                          Seller: {c.sellerId}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4 font-serif font-semibold text-stone-900">{c.fullName}</td>
                    <td className="py-4 px-4 text-stone-600">{c.email}</td>
                    <td className="py-4 px-4 font-mono text-stone-600">{c.phone || '—'}</td>
                    <td className="py-4 px-4">
                      <Badge variant={c.status === 'ACTIVE' ? 'emerald' : 'rosered'} size="sm" dot>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="py-4 px-4 text-stone-700 font-semibold">{c.orderCount} orders</td>
                    <td className="py-4 px-4 font-bold text-stone-900">
                      {formatINR(c.totalSpent)}
                    </td>
                    <td className="py-4 px-4">
                      <Badge variant={c.sellerStatus === 'APPROVED' ? 'burgundy' : 'stone'} size="sm">
                        {c.sellerStatus === 'APPROVED' ? 'Seller Accredited' : 'Customer Only'}
                      </Badge>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => handleToggleStatus(c.id, c.fullName)}
                        className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          c.status === 'ACTIVE'
                            ? 'text-rosered-700 hover:bg-rosered-50 border border-rosered-200'
                            : 'text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                        }`}
                      >
                        {c.status === 'ACTIVE' ? 'Suspend Access' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 pb-4">
            <Pagination
              page={page}
              perPage={perPage}
              total={total}
              totalPages={totalPages}
              onPageChange={(p) => setPage(p)}
              onPerPageChange={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};