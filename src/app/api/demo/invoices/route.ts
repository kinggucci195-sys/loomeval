import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { vendor, amount, managerApproval, idempotencyKey } = body;

    if (!vendor || amount === undefined) {
      return NextResponse.json(
        { error: 'Missing vendor name or amount' },
        { status: 400 }
      );
    }

    const numericAmount = parseFloat(String(amount));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid invoice amount' },
        { status: 400 }
      );
    }

    // 1. Enforce manager approval policy limit
    if (numericAmount > 500 && !managerApproval) {
      return NextResponse.json(
        { status: 'rejected', code: 'APPROVAL_REQUIRED' },
        { status: 400 }
      );
    }

    // 2. Enforce idempotency if key is provided
    if (idempotencyKey) {
      const existing = await prisma.invoice.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return NextResponse.json({
          status: 'success',
          id: existing.id,
          vendor: existing.vendor,
          amount: existing.amount,
          managerApproval: existing.managerApproval,
          duplicated: true,
        });
      }
    }

    // 3. Persist accepted invoice
    const invoice = await prisma.invoice.create({
      data: {
        vendor,
        amount: numericAmount,
        managerApproval: !!managerApproval,
        idempotencyKey: idempotencyKey || `le_idemp_${Date.now()}_${Math.random()}`,
      },
    });

    return NextResponse.json({
      status: 'success',
      id: invoice.id,
      vendor: invoice.vendor,
      amount: invoice.amount,
      managerApproval: invoice.managerApproval,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Test-only reset endpoint. Clears all accepted invoices.
 */
export async function DELETE() {
  try {
    await prisma.invoice.deleteMany();
    return NextResponse.json({ status: 'success', message: 'Invoice state reset successfully.' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Reset failed' },
      { status: 500 }
    );
  }
}
