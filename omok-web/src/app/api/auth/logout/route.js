import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieBase } from "@/lib/cookies";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, "", { ...cookieBase, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...cookieBase, maxAge: 0 });
  return res;
}
