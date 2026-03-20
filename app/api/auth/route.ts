import { NextResponse } from "next/server";

const PASSWORD = process.env.WEALTHTRACKER_PASSWORD;
const COOKIE_NAME = "wealthtracker_auth";

export async function POST(request: Request) {
  if (!PASSWORD) {
    return NextResponse.json({ ok: false, error: "Password is not configured." }, { status: 500 });
  }

  let password = "";

  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch (_error) {
    password = "";
  }

  if (password !== PASSWORD) {
    return NextResponse.json({ ok: false, error: "Invalid password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
