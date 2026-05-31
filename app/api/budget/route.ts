import { NextResponse } from "next/server";
import {
  addBudgetPlannerItem,
  deleteBudgetPlannerItem,
  getBudgetPlannerData,
  updateBudgetPlannerItem,
} from "@/lib/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  const budget = await getBudgetPlannerData();
  return NextResponse.json(budget, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await addBudgetPlannerItem(payload);
    return NextResponse.json(
      { ok: true, ...result },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create budget item.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      itemId?: string;
      category?: string;
      type?: "Fixed" | "Variable";
      monthlyAmountUsd?: number;
      notes?: string;
    };

    if (!payload.itemId) {
      return NextResponse.json({ error: "Item ID is required." }, { status: 400 });
    }

    const result = await updateBudgetPlannerItem(payload.itemId, {
      category: payload.category || "",
      type: payload.type || "Variable",
      monthlyAmountUsd: Number(payload.monthlyAmountUsd),
      notes: payload.notes || "",
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update budget item.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as { itemId?: string };

    if (!payload.itemId) {
      return NextResponse.json({ error: "Item ID is required." }, { status: 400 });
    }

    const result = await deleteBudgetPlannerItem(payload.itemId);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete budget item.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
