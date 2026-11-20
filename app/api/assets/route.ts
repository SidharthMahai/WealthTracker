import { assetSnapshot } from "@/lib/assets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await assetSnapshot()); }
  catch { return Response.json({ error: "Unable to load assets." }, { status: 503 }); }
}
export async function POST(request: Request) {
  try { return Response.json(await assetSnapshot(await request.json())); }
  catch { return Response.json({ error: "Unable to save. Check the fields and try again." }, { status: 400 }); }
}
