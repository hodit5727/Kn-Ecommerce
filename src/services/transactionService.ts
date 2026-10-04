/**
 * Virtual passbook / financial transaction service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/localStorage flow) ───────────────
 * - No localStorage, no SEED_TRANSACTIONS, no fake seller-101/seller-102
 *   records, no simulateNetworkDelay, no devController failure toggles.
 * - The server scopes every read by the role in the authenticated session:
 *   sellers only ever see their own ledger entries, admins see all records.
 *   Records are append-only / immutable server-side — no client can create,
 *   edit, or delete ledger rows through this service.
 * - The optional `sellerId` filter remains in the signature for backwards
 *   compatibility but is IGNORED: it is never forwarded, and it is never
 *   used (or trusted) for authorization. Cross-account access returns
 *   403/404 based on the session, not on query parameters.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /transactions?type=CR|DR                         -> { transactions }
 *        `type` is an optional display filter; the ledger scope itself is
 *        always derived server-side from the session (never from client
 *        query parameters such as sellerId)
 */
import type { FinancialTransaction } from '../types/transaction';
import { apiRequest } from '../api/http';

interface TransactionsResponse {
  transactions: FinancialTransaction[];
}

export const transactionService = {
  async getTransactions(filter?: {
    sellerId?: string;
    type?: 'CR' | 'DR';
  }): Promise<FinancialTransaction[]> {
    // `filter.sellerId` is intentionally NOT forwarded (see header): the
    // server derives the ledger scope from the authenticated session.
    const query = filter?.type ? `?type=${encodeURIComponent(filter.type)}` : '';
    const res = await apiRequest<TransactionsResponse>(`/transactions${query}`, {
      method: 'GET',
    });
    return res.transactions;
  },
};
