import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import crypto from "crypto";

import { ACCESS_COOKIE } from "@/lib/cookies";
import { verifyAccessToken } from "@/lib/auth";

const roomKey = (id) => `room:${id}`;
const membersKey = (id) => `room:${id}:members`;

function getCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  if (!found) return null;
  return decodeURIComponent(found.slice(name.length + 1));
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const ids = await redis.zrevrange("rooms", 0, limit - 1);
    if (!ids.length) return NextResponse.json({ rooms: [] }, { status: 200 });

    const p = redis.pipeline();
    ids.forEach((id) => {
      p.hgetall(roomKey(id));
      p.scard(membersKey(id));
    });

    const res = await p.exec();

    const rooms = [];
    for (let i = 0; i < ids.length; i++) {
      const hash = res[i * 2]?.[1] ?? {};
      const onlineCount = Number(res[i * 2 + 1]?.[1] ?? 0);
      if (!hash?.id) continue;

      rooms.push({
        id: hash.id,
        title: hash.title ?? "",
        isPrivate: hash.isPrivate === "1",
        status: hash.status ?? "waiting",
        maxPlayers: Number(hash.maxPlayers ?? 2),
        createdAt: Number(hash.createdAt ?? 0),
        onlineCount,
      });
    }

    return NextResponse.json({ rooms }, { status: 200 });
  } catch (e) {
    console.error("[API_ROOMS_GET_ERROR]", e);
    return NextResponse.json({ rooms: [], error: "failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    // 로그인 확인 (HttpOnly access 쿠키)
    const cookieHeader = req.headers.get("cookie");
    const token = getCookieFromHeader(cookieHeader, ACCESS_COOKIE);
    if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const payload = await verifyAccessToken(token);
    const ownerId = String(payload.sub);

    // body
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || "").trim();
    const isPrivate = !!body?.isPrivate;

    if (!title) return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });

    // Redis 저장
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    const p = redis.pipeline();
    p.hset(roomKey(id), {
      id,
      title,
      ownerId,
      isPrivate: isPrivate ? "1" : "0",
      status: "waiting",
      maxPlayers: "2",
      createdAt: String(createdAt),
    });
    p.zadd("rooms", createdAt, id);
    p.sadd(membersKey(id), ownerId);

    // TTL 2시간
    p.expire(roomKey(id), 60 * 60 * 2);
    p.expire(membersKey(id), 60 * 60 * 2);

    await p.exec();

    return NextResponse.json({ ok: true, roomId: id }, { status: 200 });
  } catch (e) {
    console.error("[API_ROOMS_POST_ERROR]", e);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}
