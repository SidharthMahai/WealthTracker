import { NextResponse } from "next/server";
import {
  addTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/lib/portfolio";
import type { NewTransactionInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await addTransaction(payload);
    return NextResponse.json(result, { status: 201 });
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
    return NextResponse.json(result);
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
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete transaction.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
