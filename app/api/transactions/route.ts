import { NextResponse } from "next/server";
import {
  addTransaction,
  deleteTransaction,
  getDashboardData,
  updateTransaction,
} from "@/lib/portfolio";
import type { NewTransactionInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await addTransaction(payload);
    const dashboard = await getDashboardData();
    return NextResponse.json(
      { ok: true, ...result, dashboard },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save investment entry.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      rowId?: string;
      transaction?: unknown;
    };

    if (!payload.rowId || !payload.transaction) {
      return NextResponse.json(
        { error: "Row ID and transaction data are required." },
        { status: 400 }
      );
    }

    const result = await updateTransaction(
      payload.rowId,
      payload.transaction as NewTransactionInput
    );
    const dashboard = await getDashboardData();
    return NextResponse.json(
      { ok: true, ...result, dashboard },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update transaction.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rowId = searchParams.get("rowId");

    if (!rowId) {
      return NextResponse.json(
        { error: "Row ID is required." },
        { status: 400 }
      );
    }

    const result = await deleteTransaction(rowId);
    const dashboard = await getDashboardData();
    return NextResponse.json(
      { ok: true, ...result, dashboard },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete transaction.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
