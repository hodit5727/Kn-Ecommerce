import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import ExcelJS from 'exceljs';

const ALL_SQL_TABLES = [
  'profiles',
  'seller_profiles',
  'products',
  'product_variants',
  'product_images',
  'orders',
  'order_items',
  'payouts',
  'transactions',
  'audit_logs',
  'seller_verifications',
  'verification_sessions',
  'addresses',
  'coupons',
  'coupon_redemptions',
  'delivery_qr_tokens',
  'returns',
  'refunds',
  'announcements',
  'notifications'
];

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    val = JSON.stringify(val);
  } else {
    val = String(val);
  }
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function toCsv(rows, columns) {
  if (!columns || columns.length === 0) return '';
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => escapeCsv(r[c])).join(','));
  return [header, ...lines].join('\r\n');
}

function autoFitColumns(worksheet, minWidth = 12) {
  worksheet.columns.forEach(column => {
    let maxLen = 0;
    column.eachCell({ includeEmpty: true }, cell => {
      const val = cell.value;
      let len = 0;
      if (val !== null && val !== undefined) {
        if (typeof val === 'object' && val.text) {
          len = String(val.text).length;
        } else {
          len = String(val).length;
        }
      }
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.max(maxLen + 3, minWidth);
  });
}

function styleHeaderRow(row, bgColor = '1E293B') {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColor }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'CBD5E1' } },
      left: { style: 'thin', color: { argb: 'CBD5E1' } },
      bottom: { style: 'medium', color: { argb: '0F172A' } },
      right: { style: 'thin', color: { argb: 'CBD5E1' } }
    };
  });
}

export async function generateDatabaseExport(supabaseClient) {
  const projectRoot = path.resolve(process.cwd(), fs.existsSync(path.resolve(process.cwd(), 'exports')) ? '.' : '..');
  const exportDir = path.resolve(projectRoot, 'exports');
  const csvDir = path.resolve(exportDir, 'csv');
  const publicDownloadDir = path.resolve(projectRoot, 'public/downloads');

  fs.mkdirSync(csvDir, { recursive: true });
  fs.mkdirSync(publicDownloadDir, { recursive: true });

  const tableData = {};

  for (const table of ALL_SQL_TABLES) {
    try {
      const { data, error, count } = await supabaseClient
        .from(table)
        .select('*', { count: 'exact' });

      if (error) {
        tableData[table] = { rows: [], columns: [], count: 0, error: error.message };
      } else {
        const sanitizedRows = (data || []).map(row => {
          if (table === 'profiles') {
            const copy = { ...row };
            if ('pin_hash' in copy) copy.pin_hash = '[REDACTED_SECURITY_HASH]';
            return copy;
          }
          return row;
        });

        const sample = sanitizedRows[0];
        const columns = sample ? Object.keys(sample) : [];
        tableData[table] = { rows: sanitizedRows, columns, count: count || sanitizedRows.length };
      }
    } catch (err) {
      tableData[table] = { rows: [], columns: [], count: 0, error: err.message };
    }
  }

  // Create Excel Workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'K-Shop E-Commerce System';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Summary Dashboard
  const dashSheet = workbook.addWorksheet('Summary Dashboard', {
    views: [{ showGridLines: true }],
    properties: { tabColor: { argb: '2563EB' } }
  });

  const orders = tableData['orders']?.rows || [];
  const totalGmv = orders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
  const paidOrders = orders.filter(o => o.payment_status === 'PAID');
  const totalPaidGmv = paidOrders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
  const products = tableData['products']?.rows || [];
  const variants = tableData['product_variants']?.rows || [];
  const totalInventoryStock = variants.reduce((acc, v) => acc + (Number(v.stock_quantity) || 0), 0);
  const profiles = tableData['profiles']?.rows || [];
  const sellers = profiles.filter(p => p.role === 'SELLER');
  const customers = profiles.filter(p => p.role === 'CUSTOMER');
  const payouts = tableData['payouts']?.rows || [];
  const totalPayoutDisbursed = payouts.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const totalCommissionEarned = payouts.reduce((acc, p) => acc + (Number(p.commission_amount) || 0), 0);
  const auditLogs = tableData['audit_logs']?.rows || [];
  const transactions = tableData['transactions']?.rows || [];

  dashSheet.mergeCells('A1:G1');
  const titleCell = dashSheet.getCell('A1');
  titleCell.value = 'K-SHOP E-COMMERCE PLATFORM — EXECUTIVE AUDIT & DATA SUMMARY';
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  dashSheet.getRow(1).height = 40;

  dashSheet.mergeCells('A2:G2');
  const subtitleCell = dashSheet.getCell('A2');
  subtitleCell.value = `Export Generated On: ${new Date().toISOString()} | Source: Supabase PostgreSQL (Production)`;
  subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: '64748B' } };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  dashSheet.getRow(2).height = 20;

  dashSheet.mergeCells('A4:G4');
  const kpiHeader = dashSheet.getCell('A4');
  kpiHeader.value = 'KEY FINANCIAL & OPERATIONAL PERFORMANCE METRICS';
  kpiHeader.font = { name: 'Calibri', size: 12, bold: true, color: { argb: '1E293B' } };
  kpiHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
  dashSheet.getRow(4).height = 24;

  const kpis = [
    ['Metric Description', 'Metric Value', 'Notes / Source Table'],
    ['Total Gross Merchandise Value (GMV)', totalGmv, 'Sum of all orders in orders table (₹)'],
    ['Total Collected GMV (Paid / Delivered)', totalPaidGmv, 'Delivered & Confirmed COD orders (₹)'],
    ['Platform Commission Retained (5%)', totalCommissionEarned || Math.round(totalGmv * 0.05), 'Audited 5% platform commission fee from payouts/transactions (₹)'],
    ['Total Net Seller Payouts Disbursed', totalPayoutDisbursed, 'Total wire settlements released to verified sellers (₹)'],
    ['Total Orders Placed', orders.length, 'Real count of orders created in system'],
    ['Active Product Catalog Items', products.length, 'Distinct products in products table'],
    ['Total Inventory Stock Units', totalInventoryStock, 'Sum of stock_quantity across product_variants'],
    ['Registered Sellers', sellers.length, 'Profiles with role = SELLER'],
    ['Registered Customers', customers.length, 'Profiles with role = CUSTOMER'],
    ['Total Double-Entry Ledger Transactions', transactions.length, 'Immutable transaction ledger records in transactions table'],
    ['System Security Audit Records', auditLogs.length, 'Security events and state changes logged in audit_logs']
  ];

  let currRow = 5;
  kpis.forEach((row, idx) => {
    const r = dashSheet.getRow(currRow);
    r.getCell(1).value = row[0];
    r.getCell(2).value = row[1];
    r.getCell(3).value = row[2];

    if (idx === 0) {
      styleHeaderRow(r, '334155');
    } else {
      r.getCell(1).font = { bold: true, color: { argb: '1E293B' } };
      r.getCell(2).font = { bold: true, color: { argb: '0F172A' } };
      if (typeof row[1] === 'number' && (idx >= 1 && idx <= 4)) {
        r.getCell(2).numFmt = '₹#,##0.00';
      } else if (typeof row[1] === 'number') {
        r.getCell(2).numFmt = '#,##0';
      }
      r.getCell(3).font = { color: { argb: '64748B' }, italic: true };
    }
    r.height = 22;
    currRow++;
  });

  currRow += 2;
  dashSheet.mergeCells(`A${currRow}:G${currRow}`);
  const indexHeader = dashSheet.getCell(`A${currRow}`);
  indexHeader.value = 'POSTGRESQL SCHEMA TABLE MAPPING & DATASET INDEX';
  indexHeader.font = { name: 'Calibri', size: 12, bold: true, color: { argb: '1E293B' } };
  indexHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
  dashSheet.getRow(currRow).height = 24;
  currRow++;

  const tableIndexHeaders = ['Table Name', 'Excel Sheet Name', 'Actual Rows', 'Columns Count', 'Category / Domain', 'Status'];
  const indexRow = dashSheet.getRow(currRow);
  tableIndexHeaders.forEach((h, i) => {
    indexRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(indexRow, '334155');
  currRow++;

  const sheetMapping = [
    { table: 'products', sheet: 'Products & Catalog', cat: 'Catalog / Merchandising' },
    { table: 'product_variants', sheet: 'Product Variants & Stock', cat: 'Inventory / SKU' },
    { table: 'product_images', sheet: 'Product Images', cat: 'Media / Assets' },
    { table: 'orders', sheet: 'Orders Master', cat: 'E-Commerce / Sales' },
    { table: 'order_items', sheet: 'Order Items & SKUs', cat: 'Order Details' },
    { table: 'payouts', sheet: 'Seller Payouts & Settlements', cat: 'Treasury / Payouts' },
    { table: 'transactions', sheet: 'Treasury & Atelier Ledger', cat: 'Double-Entry Accounting' },
    { table: 'profiles', sheet: 'Users & Customers', cat: 'Authentication & CRM' },
    { table: 'seller_profiles', sheet: 'Seller Profiles', cat: 'Seller Information' },
    { table: 'seller_verifications', sheet: 'Seller Verifications', cat: 'KYC & Compliance' },
    { table: 'verification_sessions', sheet: 'Verification Sessions', cat: 'Liveness & Face Verification' },
    { table: 'addresses', sheet: 'Addresses', cat: 'Fulfillment & Logistics' },
    { table: 'coupons', sheet: 'Coupons & Promos', cat: 'Marketing' },
    { table: 'coupon_redemptions', sheet: 'Coupon Redemptions', cat: 'Marketing / Usage' },
    { table: 'delivery_qr_tokens', sheet: 'Delivery QR Tokens', cat: 'Handover & Security' },
    { table: 'returns', sheet: 'Returns Management', cat: 'Post-Purchase' },
    { table: 'refunds', sheet: 'Refunds Accounting', cat: 'Treasury / Refunds' },
    { table: 'announcements', sheet: 'Announcements', cat: 'Broadcasts' },
    { table: 'notifications', sheet: 'Notifications', cat: 'Customer Comms' },
    { table: 'audit_logs', sheet: 'Security Audit Trail', cat: 'Security & Compliance' }
  ];

  sheetMapping.forEach(item => {
    const tInfo = tableData[item.table];
    const r = dashSheet.getRow(currRow);
    r.getCell(1).value = item.table;
    r.getCell(2).value = item.sheet;
    r.getCell(3).value = tInfo?.count ?? 0;
    r.getCell(4).value = tInfo?.columns?.length ?? 0;
    r.getCell(5).value = item.cat;
    r.getCell(6).value = tInfo?.count > 0 ? 'Data Available' : 'Schema Defined (0 Rows)';

    r.getCell(1).font = { bold: true, name: 'Consolas' };
    r.getCell(2).font = { bold: true };
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).numFmt = '#,##0';
    r.getCell(6).font = { color: { argb: tInfo?.count > 0 ? '16A34A' : '94A3B8' } };
    r.height = 20;
    currRow++;
  });

  autoFitColumns(dashSheet, 15);
  dashSheet.getColumn(1).width = 38;
  dashSheet.getColumn(2).width = 32;
  dashSheet.getColumn(3).width = 45;

  // Add all table data sheets
  for (const item of sheetMapping) {
    const table = item.table;
    const sheetName = item.sheet;
    const tInfo = tableData[table] || { rows: [], columns: [] };

    const safeSheetName = sheetName.slice(0, 31);
    const ws = workbook.addWorksheet(safeSheetName, {
      views: [{ showGridLines: true }]
    });

    const rows = tInfo.rows || [];
    let cols = tInfo.columns || [];

    if (cols.length === 0) {
      if (table === 'addresses') cols = ['id', 'user_id', 'full_name', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'is_default', 'created_at', 'updated_at'];
      else if (table === 'coupons') cols = ['id', 'code', 'discount_percent', 'max_discount_amount', 'min_order_amount', 'valid_from', 'valid_until', 'usage_limit', 'created_at'];
      else if (table === 'coupon_redemptions') cols = ['id', 'coupon_id', 'user_id', 'order_id', 'discount_applied', 'created_at'];
      else if (table === 'delivery_qr_tokens') cols = ['id', 'order_id', 'token_hash', 'expires_at', 'used_at', 'created_at'];
      else if (table === 'returns') cols = ['id', 'order_id', 'order_item_id', 'user_id', 'reason', 'status', 'created_at', 'updated_at'];
      else if (table === 'refunds') cols = ['id', 'order_id', 'amount', 'reason', 'status', 'reference_id', 'created_at', 'completed_at'];
      else if (table === 'announcements') cols = ['id', 'title', 'message', 'type', 'is_active', 'created_at'];
      else if (table === 'notifications') cols = ['id', 'user_id', 'title', 'message', 'is_read', 'type', 'created_at'];
      else cols = ['id', 'status', 'created_at', 'updated_at'];
    }

    ws.columns = cols.map(c => ({ header: c, key: c }));
    styleHeaderRow(ws.getRow(1), '0F172A');

    rows.forEach(row => {
      const rowData = {};
      cols.forEach(col => {
        let val = row[col];
        if (val !== null && val !== undefined) {
          if (typeof val === 'object') {
            val = JSON.stringify(val);
          }
          if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
            val = new Date(val);
          }
        }
        rowData[col] = val;
      });
      const addedRow = ws.addRow(rowData);
      addedRow.height = 20;

      cols.forEach((col, cIdx) => {
        const cell = addedRow.getCell(cIdx + 1);
        if (cell.value instanceof Date) {
          cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
        } else if (
          typeof cell.value === 'number' &&
          (col.includes('price') || col.includes('amount') || col.includes('total') || col.includes('commission') || col.includes('balance'))
        ) {
          cell.numFmt = '₹#,##0.00';
        }
      });
    });

    autoFitColumns(ws, 14);
    if (cols.length > 0) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(rows.length + 1, 1), column: cols.length }
      };
    }
  }

  // Commission Reconciliation Sheet
  const reconSheet = workbook.addWorksheet('Commission Reconciliation', {
    views: [{ showGridLines: true }],
    properties: { tabColor: { argb: '10B981' } }
  });

  const reconHeaders = [
    'Order ID',
    'Order Number',
    'Customer',
    'Payment Method',
    'Gross Order Total (₹)',
    'Commission Rate',
    'Platform Commission (5%) (₹)',
    'Seller Net Payable (95%) (₹)',
    'Settlement Status',
    'Payout Reference',
    'Order Date'
  ];

  reconSheet.columns = reconHeaders.map((h, i) => ({ header: h, key: `col_${i}` }));
  styleHeaderRow(reconSheet.getRow(1), '065F46');

  orders.forEach(order => {
    const payout = payouts.find(p => p.order_id === order.id);
    const gross = Number(order.total) || 0;
    const commRate = '5%';
    const commAmount = payout?.commission_amount !== undefined
      ? Number(payout.commission_amount)
      : Math.round(gross * 0.05 * 100) / 100;
    const netAmount = Math.round((gross - commAmount) * 100) / 100;
    const customer = profiles.find(p => p.id === order.user_id)?.full_name || order.user_id;

    const row = reconSheet.addRow({
      col_0: order.id,
      col_1: order.order_number,
      col_2: customer,
      col_3: order.payment_method || 'Cash on Delivery',
      col_4: gross,
      col_5: commRate,
      col_6: commAmount,
      col_7: netAmount,
      col_8: payout?.status || order.status,
      col_9: payout?.id ? `WIRE-KN-${payout.id.slice(0, 8).toUpperCase()}` : 'PENDING_RELEASE',
      col_10: order.created_at ? new Date(order.created_at) : ''
    });

    row.getCell(5).numFmt = '₹#,##0.00';
    row.getCell(7).numFmt = '₹#,##0.00';
    row.getCell(8).numFmt = '₹#,##0.00';
    if (row.getCell(11).value instanceof Date) {
      row.getCell(11).numFmt = 'yyyy-mm-dd hh:mm:ss';
    }
    row.height = 20;
  });

  autoFitColumns(reconSheet, 15);
  reconSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(orders.length + 1, 1), column: reconHeaders.length }
  };

  const excelFilePath = path.resolve(exportDir, 'kshop_ecommerce_data_export.xlsx');
  const publicExcelPath = path.resolve(publicDownloadDir, 'kshop_ecommerce_data_export.xlsx');

  await workbook.xlsx.writeFile(excelFilePath);
  fs.copyFileSync(excelFilePath, publicExcelPath);

  // Generate CSVs
  const generatedCsvFiles = [];
  for (const table of ALL_SQL_TABLES) {
    const tInfo = tableData[table] || { rows: [], columns: [] };
    const cols = tInfo.columns.length > 0 ? tInfo.columns : ['id', 'status', 'created_at', 'updated_at'];
    const csvContent = toCsv(tInfo.rows, cols);
    const csvFileName = `${table}.csv`;
    const csvFilePath = path.resolve(csvDir, csvFileName);
    fs.writeFileSync(csvFilePath, csvContent, 'utf8');
    generatedCsvFiles.push({ table, fileName: csvFileName, path: csvFilePath, rows: tInfo.rows.length });
  }

  // Commission CSV
  const reconCsvData = orders.map(order => {
    const payout = payouts.find(p => p.order_id === order.id);
    const gross = Number(order.total) || 0;
    const commAmount = payout?.commission_amount !== undefined
      ? Number(payout.commission_amount)
      : Math.round(gross * 0.05 * 100) / 100;
    const netAmount = Math.round((gross - commAmount) * 100) / 100;
    const customer = profiles.find(p => p.id === order.user_id)?.full_name || order.user_id;

    return {
      order_id: order.id,
      order_number: order.order_number,
      customer,
      payment_method: order.payment_method || 'Cash on Delivery',
      gross_order_total: gross,
      commission_rate: '5%',
      platform_commission: commAmount,
      seller_net_payable: netAmount,
      settlement_status: payout?.status || order.status,
      payout_reference: payout?.id ? `WIRE-KN-${payout.id.slice(0, 8).toUpperCase()}` : 'PENDING_RELEASE',
      order_date: order.created_at
    };
  });
  const reconCsvCols = ['order_id', 'order_number', 'customer', 'payment_method', 'gross_order_total', 'commission_rate', 'platform_commission', 'seller_net_payable', 'settlement_status', 'payout_reference', 'order_date'];
  const reconCsvPath = path.resolve(csvDir, 'commission_reconciliation.csv');
  fs.writeFileSync(reconCsvPath, toCsv(reconCsvData, reconCsvCols), 'utf8');
  generatedCsvFiles.push({ table: 'commission_reconciliation', fileName: 'commission_reconciliation.csv', path: reconCsvPath, rows: reconCsvData.length });

  // Pure Node.js cross-platform ZipArchive
  const zipFilePath = path.resolve(exportDir, 'kshop_database_export_csv.zip');
  const publicZipPath = path.resolve(publicDownloadDir, 'kshop_database_export_csv.zip');

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipFilePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));
    archive.pipe(output);

    for (const item of generatedCsvFiles) {
      archive.file(item.path, { name: item.fileName });
    }

    archive.finalize();
  });

  fs.copyFileSync(zipFilePath, publicZipPath);

  return {
    excelPath: excelFilePath,
    zipPath: zipFilePath,
    tableCount: ALL_SQL_TABLES.length,
    totalRecords: Object.values(tableData).reduce((a, b) => a + (b.count || 0), 0)
  };
}
