import { NextResponse } from "next/server";
import { updateFundLatestNav } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      fundId?: string;
      latestNav?: number;
      latestNavDate?: string;
    };

    if (!payload.fundId) {
      return NextResponse.json({ error: "Fund ID is required." }, { status: 400 });
    }

    const result = await updateFundLatestNav({
      fundId: payload.fundId,
      latestNav: Number(payload.latestNav),
      latestNavDate: payload.latestNavDate || new Date().toISOString().slice(0, 10),
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update fund NAV.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

