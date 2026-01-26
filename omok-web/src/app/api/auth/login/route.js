import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signAccessToken, signRefreshToken } from "@/lib/auth";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookie, refreshCookie } from "@/lib/cookies";

export async function POST(req) {
  const body = await req.json().catch(() => null);
  const username = body?.username?.trim();
  const password = body?.password;

  if (!username || typeof password !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  const payload = { sub: user.id, username: user.username };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, accessToken, accessCookie);
  res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookie);

  return res;
}
