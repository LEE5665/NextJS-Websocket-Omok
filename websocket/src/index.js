require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");
const crypto = require("crypto");

const PORT = process.env.PORT || 4000;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const app = express();
app.use(cors({ origin: WEB_ORIGIN, credentials: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: WEB_ORIGIN, credentials: true },
});

const redis = new Redis(REDIS_URL);

const roomKey = (id) => `room:${id}`;
const membersKey = (id) => `room:${id}:members`;

const wsTicketKey = (t) => `ws_ticket:${t}`;
const roomSockKey = (id) => `room:${id}`;

io.use(async (socket, next) => {
  try {
    const wsToken = socket.handshake.auth?.token;
    if (!wsToken) return next(new Error("missing_ws_token"));

    const raw = await redis.get(wsTicketKey(wsToken));
    if (!raw) return next(new Error("invalid_or_expired_ws_token"));

    const payload = JSON.parse(raw);
    if (!payload?.userId) {
      await redis.del(wsTicketKey(wsToken));
      return next(new Error("bad_ws_token_payload"));
    }

    // 1회용 소비
    await redis.del(wsTicketKey(wsToken));

    socket.data.userId = payload.userId;
    socket.data.username = payload.username || "";

    next();
  } catch (e) {
    next(new Error("ws_auth_failed"));
  }
});

io.on("connection", (socket) => {
  socket.on("room:create", async ({ title, isPrivate, password } = {}, ack) => {
    try {
      const userId = socket.data.userId;

      const clean = String(title || "").trim();
      if (!clean) throw new Error("title_required");

      const id = crypto.randomUUID();
      const createdAt = Date.now();

      const p = redis.pipeline();
      p.hset(roomKey(id), {
        id,
        title: clean,
        ownerId: userId,
        isPrivate: isPrivate ? "1" : "0",
        // password는 나중에 해시로 저장
        status: "waiting",
        maxPlayers: "2",
        createdAt: String(createdAt),
      });
      p.zadd("rooms", createdAt, id);
      p.sadd(membersKey(id), userId);

      p.expire(roomKey(id), 60 * 60 * 2);
      p.expire(membersKey(id), 60 * 60 * 2);

      await p.exec();

      socket.join(roomSockKey(id));

      ack && ack({ ok: true, roomId: id });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "create_failed" });
    }
  });

  socket.on("room:join", async ({ roomId } = {}, ack) => {
    try {
      const userId = socket.data.userId;
      if (!roomId) throw new Error("roomId_required");

      const room = await redis.hgetall(roomKey(roomId));
      if (!room?.id) throw new Error("room_not_found");

      const maxPlayers = Number(room.maxPlayers || 2);
      const count = await redis.scard(membersKey(roomId));
      if (count >= maxPlayers) throw new Error("room_full");

      await redis.sadd(membersKey(roomId), userId);
      socket.join(roomSockKey(roomId));

      const isOwner = room.ownerId === userId;

      ack && ack({
        ok: true,
        room: {
          id: room.id,
          title: room.title,
          status: room.status || "waiting",
          maxPlayers,
        },
        isOwner,
      });
      socket.data.roomId = roomId;
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "join_failed" });
    }
  });
  socket.on("disconnecting", async () => {
    const userId = socket.data.userId;
    const roomId = socket.data.roomId;
    if (!roomId) return;

    try {
      const room = await redis.hgetall(roomKey(roomId));
      if (!room?.id) return;

      const isOwner = room.ownerId === userId;

      if (isOwner) {
        // 방장이 나감 -> 방 삭제
        const p = redis.pipeline();
        p.del(roomKey(roomId));            // 방 메타
        p.del(membersKey(roomId));         // 멤버 목록
        p.zrem("rooms", roomId);           // 로비 목록에서 제거
        await p.exec();

        // 남은 사람들에게 방 종료 알림
        io.to(roomSockKey(roomId)).emit("room:closed", { roomId });
      } else {
        // 참가자가 나감 -> 멤버에서 제거
        await redis.srem(membersKey(roomId), userId);
        // 알림
        io.to(roomSockKey(roomId)).emit("room:member_left", { roomId, userId });
      }
    } catch (e) {
      console.error("[disconnecting cleanup error]", e);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`WS listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${WEB_ORIGIN}`);
  console.log(`Redis: ${REDIS_URL}`);
});