/**
 * Server-driven pagination control (admin lists).
 *
 * Renders: rows-per-page selector · "X–Y of Z" · Prev/Next + page window.
 * All totals come from the server's pagination metadata — the client never
 * invents counts. Safe for empty sets (totalPages clamped to >= 1 for
 * display; the caller decides whether to hide the control entirely).
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

const PER_PAGE_OPTIONS = [10, 25, 50];

/** A compact window of up to 5 page numbers centered on the current page. */
function pageWindow(page: number, totalPages: number, max = 5): number[] {
  const last = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), last);
  const start = Math.max(1, Math.min(safePage - Math.floor(max / 2), last - max + 1));
  const end = Math.min(last, start + max - 1);
  const pages: number[] = [];
  for (let i = start; i <= end; i += 1) pages.push(i);
  return pages;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  perPage,
  total,
  totalPages,
  onPageChange,
  onPerPageChange,
}) => {
  const pages = pageWindow(page, totalPages);
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 pb-1 text-xs text-stone-600">
      <div className="flex items-center gap-2">
        <span className="text-stone-400">Rows</span>
        <select
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          aria-label="Rows per page"
          className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-burgundy"
        >
          {PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-stone-400">
          {from}–{to} of {total.toLocaleString()} records
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="p-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pages.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPageChange(n)}
            aria-current={n === page ? 'page' : undefined}
            className={`min-w-[28px] px-1.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
              n === page
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100 border border-stone-200'
            }`}
          >
            {n}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="p-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <span className="ml-2 text-stone-400">
          Page {Math.min(Math.max(1, page), Math.max(1, totalPages))} of {Math.max(1, totalPages)}
        </span>
      </div>
    </div>
  );
};