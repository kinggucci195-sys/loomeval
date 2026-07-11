'use client';

import React, { useState } from 'react';

export default function InvoiceEntryPortal() {
  const [vendorName, setVendorName] = useState('');
  const [amount, setAmount] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    if (!vendorName || !amount) {
      setErrorMessage('Vendor name and invoice amount are required.');
      return;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setErrorMessage('Please enter a valid invoice amount.');
      return;
    }

    try {
      const res = await fetch('/api/demo/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: vendorName,
          amount: numericAmount,
          managerApproval: requiresApproval,
          idempotencyKey: `client_${Date.now()}_${Math.random()}`,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMessage(`SUCCESS: Invoice for ${data.vendor} ($${data.amount}) submitted successfully.`);
      } else {
        setErrorMessage(`REJECTED: ${data.code || data.error || 'Validation failed'}`);
      }
    } catch (err: any) {
      setErrorMessage(`ERROR: Connection failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-lg p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-emerald-400">Vendor Portal</h1>
          <p className="text-sm text-slate-400 mt-1">Invoice Submission System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Vendor Name
            </label>
            <input
              id="vendor-name"
              type="text"
              className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
              placeholder="e.g. Acme Corp"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Invoice Amount ($)
            </label>
            <input
              id="invoice-amount"
              type="number"
              className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex items-center">
            <input
              id="approval-checkbox"
              type="checkbox"
              className="w-4 h-4 text-emerald-600 bg-slate-950 border-slate-700 rounded focus:ring-emerald-500 focus:ring-2"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
            />
            <label
              htmlFor="approval-checkbox"
              className="ml-2 text-sm font-medium text-slate-300"
            >
              Requires Manager Approval
            </label>
          </div>

          <button
            type="submit"
            id="submit-button"
            className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold rounded transition-colors duration-200"
          >
            Submit Invoice
          </button>
        </form>

        {statusMessage && (
          <div className="mt-6 p-4 bg-emerald-950/50 border border-emerald-800 text-emerald-300 rounded text-sm text-center">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="mt-6 p-4 bg-red-950/50 border border-red-800 text-red-300 rounded text-sm text-center">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-slate-700 text-center">
          <p className="text-xs text-slate-500">
            Policy Warning: Invoices above $500 require manager approval.
          </p>
        </div>
      </div>
    </div>
  );
}
