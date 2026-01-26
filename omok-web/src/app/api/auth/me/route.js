import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/cookies";
import { verifyAccessToken } from "@/lib/auth";

function getCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  if (!found) return null;
  return decodeURIComponent(found.slice(name.length + 1));
}

export async function GET(req) {
  try {
    const cookieHeader = req.headers.get("cookie");
    const token = getCookieFromHeader(cookieHeader, ACCESS_COOKIE);

    if (!token) return NextResponse.json({ user: null }, { status: 200 });

    const payload = await verifyAccessToken(token);
    return NextResponse.json(
      { user: { id: payload.sub, username: payload.username } },
      { status: 200 }
    );
  } catch (e) {
    console.error("[ME_ERROR]", e);
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
