import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import crypto from "crypto";

import { ACCESS_COOKIE } from "@/lib/cookies";
import { verifyAccessToken } from "@/lib/auth";

const roomKey = (id) => `room:${id}`;            // HASH
const membersKey = (id) => `room:${id}:members`; // SET
const readyKey = (id) => `room:${id}:ready`;     // HASH
const gameKey = (id) => `room:${id}:game`;       // HASH

const GAME_SIZE = 15;

function emptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}
function boardToString(board) {
  return JSON.stringify(board);
}

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
      p.hget(gameKey(id), "status");  // status는 game.status
    });

    const res = await p.exec();

    const rooms = [];
    for (let i = 0; i < ids.length; i++) {
      const hash = res[i * 3]?.[1] ?? {};
      const onlineCount = Number(res[i * 3 + 1]?.[1] ?? 0);
      const gameStatus = String(res[i * 3 + 2]?.[1] ?? "waiting");

      if (!hash?.id) continue;

      rooms.push({
        id: hash.id,
        title: hash.title ?? "",
        isPrivate: hash.isPrivate === "1",
        maxPlayers: Number(hash.maxPlayers ?? 2),
        createdAt: Number(hash.createdAt ?? 0),
        onlineCount,
        status: gameStatus || "waiting", // 여기서 보여줄 상태
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
    const ownerId = String(payload.username);

    // body
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || "").trim();
    const isPrivate = !!body?.isPrivate;

    if (!title) return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });

    // create
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    const ttlSec = 60 * 60 * 2; // 2h

    const p = redis.pipeline();

    p.hset(roomKey(id), {
      id,
      title,
      ownerId,
      isPrivate: isPrivate ? "1" : "0",
      maxPlayers: "2",
      createdAt: String(createdAt),
    });
    p.zadd("rooms", createdAt, id);

    p.sadd(membersKey(id), ownerId);

    p.hset(gameKey(id), {
      status: "waiting",
      size: String(GAME_SIZE),
      board: boardToString(emptyBoard(GAME_SIZE)),
      turn: "black",
      black: "",
      white: "",
      winner: "",
      lastX: "",
      lastY: "",
    });

    // TTL
    p.expire(roomKey(id), ttlSec);
    p.expire(membersKey(id), ttlSec);
    p.expire(readyKey(id), ttlSec);
    p.expire(gameKey(id), ttlSec);

    await p.exec();

    return NextResponse.json({ ok: true, roomId: id }, { status: 200 });
  } catch (e) {
    console.error("[API_ROOMS_POST_ERROR]", e);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}
