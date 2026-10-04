/** Indian Rupee (INR) money formatting — K-Shop is an INR-only platform. */
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * Format a money value as ₹ with Indian digit grouping (e.g. ₹1,29,999).
 * Never renders a dollar sign; non-finite/absent values fall back to ₹0.
 */
export function formatINR(value: number): string {
  return inr.format(Number.isFinite(value) ? value : 0);
}