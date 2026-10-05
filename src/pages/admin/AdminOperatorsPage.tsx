import React, { useState, useEffect } from 'react';
import { adminService, AdminOperator, OperatorRole } from '../../services/adminService';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { ErrorState } from '../../components/common/ErrorState';
import { useToast } from '../../context/ToastContext';
import {
  UserPlus,
  Shield,
  Truck,
  ShieldAlert,
  Trash2,
  CheckCircle2,
  XCircle,
  Copy,
  Database,
  Eye,
  EyeOff,
  UserCheck,
  FileSpreadsheet,
  UploadCloud,
  Download,
  Loader2
} from 'lucide-react';
import { exportToCsv } from '../../lib/csvExport';

const SUPABASE_OPERATORS_SQL = `-- ====================================================================
-- PLATFORM OPERATORS & STAFF MANAGEMENT SCHEMA (Supabase PostgreSQL)
-- Run this query in your Supabase SQL Editor
-- ====================================================================

-- 1. Create operator roles enum (if not exists)
DO $$ BEGIN
  CREATE TYPE operator_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'DELIVERY_PERSON');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create platform operators table
CREATE TABLE IF NOT EXISTS platform_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'DELIVERY_PERSON')),
  phone text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;

-- 4. Admin-only policies
DROP POLICY IF EXISTS "Admins can view operators" ON platform_operators;
CREATE POLICY "Admins can view operators" ON platform_operators
  FOR SELECT USING (
    auth.jwt() ->> 'role' = 'ADMIN' OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

DROP POLICY IF EXISTS "Admins can insert operators" ON platform_operators;
CREATE POLICY "Admins can insert operators" ON platform_operators
  FOR INSERT WITH CHECK (
    auth.jwt() ->> 'role' = 'ADMIN' OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

DROP POLICY IF EXISTS "Admins can update operators" ON platform_operators;
CREATE POLICY "Admins can update operators" ON platform_operators
  FOR UPDATE USING (
    auth.jwt() ->> 'role' = 'ADMIN' OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

DROP POLICY IF EXISTS "Admins can delete operators" ON platform_operators;
CREATE POLICY "Admins can delete operators" ON platform_operators
  FOR DELETE USING (
    auth.jwt() ->> 'role' = 'ADMIN' OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );
`;

export const AdminOperatorsPage: React.FC = () => {
  const [operators, setOperators] = useState<AdminOperator[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Form states
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [role, setRole] = useState<OperatorRole>('ADMIN');
  const [password, setPassword] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // CSV Bulk Import States
  const [isCsvModalOpen, setIsCsvModalOpen] = useState<boolean>(false);
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvRows, setCsvRows] = useState<Array<{
    fullName: string;
    email: string;
    role: OperatorRole;
    password: string;
    phone?: string;
    status: 'pending' | 'success' | 'error';
    errorMsg?: string;
  }>>([]);
  const [isCsvImporting, setIsCsvImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const downloadCsvTemplate = () => {
    const template = "fullName,email,role,password,phone\nJohn Courier,courier1@kshop.ac.in,DELIVERY_PERSON,Delivery@123,9876543210\nCampus Courier,courier2@kshop.ac.in,DELIVERY_PERSON,Delivery@123,9876543211\nStore Staff,staff@kshop.ac.in,ADMIN,Staff@123,9876543212";
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'operators_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result || '');
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) {
        showToast('CSV file is empty or missing headers.', 'error');
        return;
      }

      const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
      const fullNameIdx = header.findIndex((h) => h.includes('name'));
      const emailIdx = header.findIndex((h) => h.includes('email'));
      const roleIdx = header.findIndex((h) => h.includes('role'));
      const passwordIdx = header.findIndex((h) => h.includes('pass'));
      const phoneIdx = header.findIndex((h) => h.includes('phone') || h.includes('mobile'));

      const parsed: Array<{
        fullName: string;
        email: string;
        role: OperatorRole;
        password: string;
        phone?: string;
        status: 'pending' | 'success' | 'error';
      }> = [];

      for (let i = 1; i < lines.length; i++) {
        const rawCols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
        if (rawCols.length < 2) continue;

        const rowName = fullNameIdx >= 0 ? rawCols[fullNameIdx] : rawCols[0] || '';
        const rowEmail = emailIdx >= 0 ? rawCols[emailIdx] : rawCols[1] || '';
        let rowRole: OperatorRole = 'DELIVERY_PERSON';
        const rawRole = (roleIdx >= 0 ? rawCols[roleIdx] : rawCols[2] || '').toUpperCase();
        if (rawRole.includes('SUPER')) rowRole = 'SUPER_ADMIN';
        else if (rawRole.includes('ADMIN')) rowRole = 'ADMIN';
        else rowRole = 'DELIVERY_PERSON';

        const rowPass = passwordIdx >= 0 ? rawCols[passwordIdx] : rawCols[3] || 'Delivery@123';
        const rowPhone = phoneIdx >= 0 ? rawCols[phoneIdx] : rawCols[4] || '';

        if (rowName && rowEmail && rowEmail.includes('@')) {
          parsed.push({
            fullName: rowName,
            email: rowEmail.toLowerCase(),
            role: rowRole,
            password: rowPass.length >= 6 ? rowPass : 'Delivery@123',
            phone: rowPhone || undefined,
            status: 'pending',
          });
        }
      }

      setCsvRows(parsed);
      if (parsed.length === 0) {
        showToast('No valid operator rows found in CSV.', 'error');
      } else {
        showToast(`Parsed ${parsed.length} operators from CSV. Ready to import.`);
      }
    };
    reader.readAsText(file);
  };

  const handleStartCsvImport = async () => {
    if (csvRows.length === 0) return;
    setIsCsvImporting(true);
    setImportProgress({ current: 0, total: csvRows.length });

    let successCount = 0;
    let failCount = 0;
    const updatedRows = [...csvRows];

    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      try {
        await adminService.createOperator({
          fullName: row.fullName,
          email: row.email,
          role: row.role,
          password: row.password,
          phone: row.phone,
        });
        row.status = 'success';
        successCount++;
      } catch (err: any) {
        row.status = 'error';
        row.errorMsg = err.message || 'Creation failed';
        failCount++;
      }
      setCsvRows([...updatedRows]);
      setImportProgress({ current: i + 1, total: updatedRows.length });
    }

    setIsCsvImporting(false);
    showToast(`Bulk Import Complete: ${successCount} created, ${failCount} failed.`);
    fetchOperators();
  };

  const { showToast } = useToast();

  const fetchOperators = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getOperators();
      setOperators(data);
    } catch (err: any) {
      if (err.status === 401 || err.message?.toLowerCase().includes('not signed in')) {
        window.location.href = `/admin/login?from=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      setError(err.message || 'Unable to load operator team records.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOperators();
  }, []);

  const handleCreateOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password) {
      showToast('Please fill in all mandatory fields.', 'error');
      return;
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await adminService.createOperator({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        password,
        phone: phone.trim() || undefined,
      });

      showToast(`Operator "${created.fullName}" created successfully!`);
      setFullName('');
      setEmail('');
      setPassword('');
      setPhone('');
      setRole('ADMIN');
      setIsAddModalOpen(false);
      fetchOperators();
    } catch (err: any) {
      showToast(err.message || 'Failed to create operator account.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (op: AdminOperator) => {
    try {
      await adminService.toggleOperatorStatus(op.id);
      showToast(`Status updated for ${op.fullName}.`);
      fetchOperators();
    } catch (err: any) {
      showToast(err.message || 'Failed to update operator status.', 'error');
    }
  };

  const handleDelete = async (op: AdminOperator) => {
    if (!window.confirm(`Are you sure you want to remove operator "${op.fullName}"?`)) {
      return;
    }

    try {
      await adminService.deleteOperator(op.id);
      showToast(`Operator "${op.fullName}" removed.`);
      fetchOperators();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete operator.', 'error');
    }
  };

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(SUPABASE_OPERATORS_SQL);
    showToast('Supabase SQL copied to clipboard!');
  };

  const handleExportCsv = () => {
    if (operators.length === 0) {
      showToast('No operators to export.', 'error');
      return;
    }
    exportToCsv<AdminOperator>(
      'kshop_operators',
      [
        { header: 'Operator ID', key: 'id' },
        { header: 'Full Name', key: 'fullName' },
        { header: 'Email Address', key: 'email' },
        { header: 'Assigned Role', key: 'role' },
        { header: 'Phone Number', key: (o) => o.phone || 'N/A' },
        { header: 'Operational Status', key: 'status' },
        { header: 'Registered At', key: (o) => o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'N/A' },
      ],
      operators
    );
    showToast(`Exported ${operators.length} operators to CSV!`);
  };

  const getRoleBadge = (opRole: OperatorRole) => {
    switch (opRole) {
      case 'SUPER_ADMIN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
            <ShieldAlert className="w-3.5 h-3.5 text-purple-700" /> Super Admin
          </span>
        );
      case 'DELIVERY_PERSON':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <Truck className="w-3.5 h-3.5 text-emerald-700" /> Delivery Person
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <Shield className="w-3.5 h-3.5 text-blue-700" /> Admin
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="border-b border-cream-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-burgundy block mb-1">
            Access Governance
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Operators & Staff Management
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Manage platform administrators, super admins, and campus delivery personnel.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSqlModalOpen(true)}
            leftIcon={<Database className="w-4 h-4" />}
          >
            Supabase SQL
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isLoading || operators.length === 0}
            leftIcon={<Download className="w-4 h-4 text-emerald-600" />}
          >
            Export CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCsvModalOpen(true)}
            leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
          >
            Bulk Import CSV
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            leftIcon={<UserPlus className="w-4 h-4" />}
          >
            Add New Operator
          </Button>
        </div>
      </div>

      {/* Operator List */}
      {error ? (
        <ErrorState message={error} onRetry={fetchOperators} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Loading operator team...</div>
      ) : operators.length === 0 ? (
        <div className="bg-white rounded-3xl border border-cream-200 p-12 text-center shadow-soft">
          <Shield className="w-12 h-12 text-stone-300 mx-auto mb-3" />
          <h3 className="font-serif font-bold text-lg text-stone-900">No Custom Operators Added Yet</h3>
          <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto">
            You can add Super Admins, Product Admins, or Delivery Personnel with login credentials to manage operations.
          </p>
          <Button
            variant="primary"
            size="sm"
            className="mt-5"
            onClick={() => setIsAddModalOpen(true)}
            leftIcon={<UserPlus className="w-4 h-4" />}
          >
            Add First Operator
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Operator Name</th>
                  <th className="py-4 px-4">Role</th>
                  <th className="py-4 px-4">Contact Phone</th>
                  <th className="py-4 px-4">Account Status</th>
                  <th className="py-4 px-4">Created Date</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {operators.map((op) => (
                  <tr key={op.id} className="hover:bg-cream-50/50">
                    <td className="py-4 px-6">
                      <p className="font-bold text-stone-900 text-xs">{op.fullName}</p>
                      <p className="text-[11px] text-stone-500">{op.email}</p>
                    </td>

                    <td className="py-4 px-4">
                      {getRoleBadge(op.role)}
                    </td>

                    <td className="py-4 px-4 text-stone-600">
                      {op.phone || <span className="text-stone-400 italic">Not set</span>}
                    </td>

                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          op.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {op.status === 'ACTIVE' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        {op.status}
                      </span>
                    </td>

                    <td className="py-4 px-4 text-stone-500 text-[11px]">
                      {op.createdAt ? new Date(op.createdAt).toLocaleDateString() : 'Active'}
                    </td>

                    <td className="py-4 px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(op)}
                          className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                            op.status === 'ACTIVE'
                              ? 'border-stone-300 text-stone-600 hover:bg-stone-100'
                              : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {op.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(op)}
                          className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors"
                          title="Remove Operator"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Operator Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Platform Operator"
        subtitle="Create staff account with role and password credentials"
        maxWidth="md"
      >
        <form onSubmit={handleCreateOperator} className="space-y-4">
          <Input
            label="Full Name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ramesh Kumar"
          />

          <Input
            label="Email Address"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. ramesh.admin@kshop.edu"
          />

          <div>
            <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
              Operator Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OperatorRole)}
              className="w-full bg-white border border-stone-200 rounded-xl p-3 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
            >
              <option value="ADMIN">Admin (Order, Product & Customer Management)</option>
              <option value="SUPER_ADMIN">Super Admin (Full Platform Control & Governance)</option>
              <option value="DELIVERY_PERSON">Delivery Person (Campus Delivery & Cash Settlement)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
              Login Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full bg-white border border-stone-200 rounded-xl p-3 pr-10 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-stone-400 hover:text-stone-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Input
            label="Mobile Phone Number (Optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit mobile number"
          />

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-cream-200">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              isLoading={isSubmitting}
              leftIcon={<UserCheck className="w-4 h-4" />}
            >
              Create Operator
            </Button>
          </div>
        </form>
      </Modal>

      {/* Supabase SQL Queries Modal */}
      <Modal
        isOpen={isSqlModalOpen}
        onClose={() => setIsSqlModalOpen(false)}
        title="Supabase SQL Setup Queries"
        subtitle="Run this schema in your Supabase SQL Editor for operators table and RLS"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-stone-600">
            Copy and paste this script directly into your Supabase Dashboard &gt; <strong>SQL Editor</strong> &gt; <strong>New Query</strong> to create the <code>platform_operators</code> table with full Row Level Security policies.
          </p>

          <div className="relative bg-stone-900 text-stone-100 rounded-2xl p-4 font-mono text-[11px] max-h-80 overflow-y-auto">
            <pre className="whitespace-pre">{SUPABASE_OPERATORS_SQL}</pre>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-cream-200">
            <Button
              variant="outline"
              size="sm"
              onClick={copySqlToClipboard}
              leftIcon={<Copy className="w-4 h-4" />}
            >
              Copy SQL Script
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsSqlModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* CSV Bulk Import Modal */}
      <Modal
        isOpen={isCsvModalOpen}
        onClose={() => {
          if (!isCsvImporting) {
            setIsCsvModalOpen(false);
            setCsvRows([]);
            setCsvFileName('');
          }
        }}
        title="Bulk Import Operators via CSV"
        subtitle="Upload a CSV file to create multiple delivery personnel and staff members in bulk"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-emerald-50 rounded-2xl border border-emerald-100">
            <div>
              <p className="text-xs font-semibold text-emerald-900">Standard CSV Format</p>
              <p className="text-[11px] text-emerald-700">Columns: fullName, email, role, password, phone</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadCsvTemplate}
              leftIcon={<Download className="w-3.5 h-3.5 text-emerald-700" />}
              className="border-emerald-200 text-emerald-800 hover:bg-emerald-100 text-xs py-1"
            >
              Download Template
            </Button>
          </div>

          <div className="border-2 border-dashed border-stone-200 rounded-2xl p-6 text-center hover:border-burgundy/50 transition-colors bg-stone-50/50">
            <UploadCloud className="w-8 h-8 text-stone-400 mx-auto mb-2" />
            <p className="text-xs font-semibold text-stone-700">
              {csvFileName ? `Selected: ${csvFileName}` : 'Choose a .csv file from your computer'}
            </p>
            <p className="text-[11px] text-stone-400 mt-0.5">Supports comma-separated UTF-8 values</p>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvFileChange}
              disabled={isCsvImporting}
              className="mt-3 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-burgundy file:text-white hover:file:bg-burgundy-900 cursor-pointer"
            />
          </div>

          {/* Parsed Rows Preview */}
          {csvRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  Detected Operators ({csvRows.length})
                </span>
                {isCsvImporting && (
                  <span className="text-xs font-semibold text-burgundy flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Processing {importProgress.current} of {importProgress.total}...
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {isCsvImporting && (
                <div className="w-full bg-stone-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-burgundy h-1.5 transition-all duration-300 rounded-full"
                    style={{
                      width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              )}

              <div className="max-h-56 overflow-y-auto border border-cream-200 rounded-2xl divide-y divide-cream-100 bg-white">
                {csvRows.map((row, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between text-xs">
                    <div className="min-w-0 pr-3">
                      <p className="font-semibold text-stone-900 truncate">{row.fullName}</p>
                      <p className="text-[11px] text-stone-500 truncate">{row.email} • {row.phone || 'No phone'}</p>
                      {row.errorMsg && (
                        <p className="text-[11px] text-rose-600 font-medium mt-0.5">{row.errorMsg}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-700">
                        {row.role}
                      </span>
                      {row.status === 'success' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      )}
                      {row.status === 'error' && (
                        <XCircle className="w-4 h-4 text-rose-600" />
                      )}
                      {row.status === 'pending' && (
                        <span className="w-2 h-2 rounded-full bg-stone-300" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-cream-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsCsvModalOpen(false);
                setCsvRows([]);
                setCsvFileName('');
              }}
              disabled={isCsvImporting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleStartCsvImport}
              disabled={csvRows.length === 0 || isCsvImporting}
              isLoading={isCsvImporting}
              leftIcon={<UploadCloud className="w-4 h-4" />}
            >
              Import {csvRows.length > 0 ? `${csvRows.length} Operators` : 'Operators'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
