/**
 * Universal CSV Export Utility for K-SHOP Admin Dashboard
 * Handles proper escaping, UTF-8 BOM for Excel/Numbers compatibility, and file downloads.
 */

export interface CsvColumn<T> {
  header: string;
  key: keyof T | ((item: T) => any);
}

export function exportToCsv<T extends Record<string, any>>(
  filename: string,
  columns: CsvColumn<T>[],
  data: T[]
): void {
  if (!data || data.length === 0) {
    throw new Error('No records available to export.');
  }

  const escapeCell = (val: any): string => {
    if (val === null || val === undefined) return '""';
    let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerRow = columns.map((c) => escapeCell(c.header)).join(',');
  const dataRows = data.map((item) => {
    return columns
      .map((c) => {
        const val = typeof c.key === 'function' ? c.key(item) : item[c.key];
        return escapeCell(val);
      })
      .join(',');
  });

  // Prepend UTF-8 BOM (\uFEFF) so Microsoft Excel, LibreOffice, and Google Sheets display symbols and formatting cleanly
  const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const timestamp = new Date().toISOString().slice(0, 10);
  link.setAttribute('download', `${filename}_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
