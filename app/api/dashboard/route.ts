import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const dashboard = await getDashboardData();
  return NextResponse.json(dashboard, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
