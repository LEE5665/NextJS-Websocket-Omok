import { NextResponse } from "next/server";
import crypto from "crypto";
import { redis } from "@/lib/redis";
import { ACCESS_COOKIE } from "@/lib/cookies";
import { verifyAccessToken } from "@/lib/auth";

function getCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  if (!found) return null;
  return decodeURIComponent(found.slice(name.length + 1));
}

export async function POST(req) {
  try {
    const cookieHeader = req.headers.get("cookie");
    const token = getCookieFromHeader(cookieHeader, ACCESS_COOKIE);
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const payload = await verifyAccessToken(token);

    const wsToken = "ws_" + crypto.randomBytes(32).toString("hex");
    await redis.set(
      `ws_ticket:${wsToken}`,
      JSON.stringify({ userId: payload.sub, username: payload.username, iat: Date.now() }),
      "EX",
      30
    );

    return NextResponse.json({ token: wsToken }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
