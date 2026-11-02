/**
 * Standard date and product code formatting utilities.
 * Enforces DD/MM/YYYY date presentation across all order and transaction ledgers.
 */

export function formatDateDDMMYYYY(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Derives the canonical K-Shop product identifier (e.g. KNPR-2298)
 * consistently from the product SKU or UUID.
 */
export function formatProductCode(sku?: string, productId?: string): string {
  if (sku && String(sku).startsWith('KNPR-')) {
    return String(sku).split('-').slice(0, 2).join('-');
  }
  const itemMatch = String(sku || '').match(/\d{4}/);
  if (itemMatch) return `KNPR-${itemMatch[0]}`;
  const itemHex = String(productId || '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  if (itemHex) {
    const digits = String((parseInt(itemHex, 16) % 9000) + 1000);
    return `KNPR-${digits}`;
  }
  return 'KNPR-1001';
}
