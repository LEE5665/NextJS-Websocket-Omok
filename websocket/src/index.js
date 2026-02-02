// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");

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

// ------------------ keys ------------------
const roomKey = (id) => `room:${id}`;              // HASH
const membersKey = (id) => `room:${id}:members`;   // SET
const readyKey = (id) => `room:${id}:ready`;       // HASH user -> "1"/"0"
const gameKey = (id) => `room:${id}:game`;         // HASH
const roomChatKey = (id) => `room:${id}:chat`;     // LIST

const wsTicketKey = (t) => `ws_ticket:${t}`;
const roomSockKey = (id) => `room:${id}`;          // socket.io room name
const userRoom = (u) => `user:${u}`;

const LOBBY_ROOM = "lobby";
const lobbySocketsKey = (u) => `lobby:sockets:${u}`; // SET
const lobbyUsersKey = "lobby:users";                 // SET

const CHAT_KEEP = 50;

const GAME_SIZE = 15;

// ------------------ presence (optional) ------------------
const presenceKey = (userId) => `presence:user:${userId}`;
const presenceSocketsKey = (userId) => `presence:sockets:${userId}`;
const PRESENCE_TTL_SEC = 60;
const HEARTBEAT_SEC = 25;

async function bumpPresence(userId, socketId) {
  const expiresAt = Date.now() + PRESENCE_TTL_SEC * 1000;
  const p = redis.pipeline();
  p.set(presenceKey(userId), "1", "EX", PRESENCE_TTL_SEC);
  p.sadd(presenceSocketsKey(userId), socketId);
  p.expire(presenceSocketsKey(userId), PRESENCE_TTL_SEC + 30);
  p.zadd("presence:online", expiresAt, String(userId));
  await p.exec();
}
async function maybeClearPresence(userId, socketId) {
  await redis.srem(presenceSocketsKey(userId), socketId);
  const left = await redis.scard(presenceSocketsKey(userId));
  if (left <= 0) {
    const q = redis.pipeline();
    q.del(presenceKey(userId));
    q.zrem("presence:online", String(userId));
    q.del(presenceSocketsKey(userId));
    await q.exec();
  }
}

// ------------------ helpers ------------------
function emptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}
function boardToString(board) {
  return JSON.stringify(board);
}
function stringToBoard(s) {
  try {
    const b = JSON.parse(s);
    if (!Array.isArray(b)) return null;
    return b;
  } catch {
    return null;
  }
}

function publicGame(g) {
  return {
    status: g.status || "waiting",
    size: Number(g.size || GAME_SIZE),
    board: stringToBoard(g.board) || emptyBoard(Number(g.size || GAME_SIZE)),
    turn: g.turn || "black",
    black: g.black || "",
    white: g.white || "",
    winner: g.winner || "",
    lastX: g.lastX === "" ? null : Number(g.lastX),
    lastY: g.lastY === "" ? null : Number(g.lastY),
  };
}

async function getOrInitGame(rid) {
  const g = await redis.hgetall(gameKey(rid));
  if (g?.status) return g;

  const board = emptyBoard(GAME_SIZE);
  const init = {
    status: "waiting", // waiting | playing | ended
    size: String(GAME_SIZE),
    board: boardToString(board),
    turn: "black",
    black: "",
    white: "",
    winner: "",
    lastX: "",
    lastY: "",
  };
  await redis.hset(gameKey(rid), init);
  return init;
}

async function buildReadyMap(rid) {
  const members = await redis.smembers(membersKey(rid));
  const readyRaw = await redis.hgetall(readyKey(rid)); // HASH
  const readyMap = {};
  for (const m of members) readyMap[m] = readyRaw?.[m] === "1";
  return { members, readyMap, readyRaw };
}

async function resetGameToWaiting(rid) {
  // 게임/레디 초기화 + 방 status waiting
  const size = GAME_SIZE;
  const board = emptyBoard(size);

  const p = redis.pipeline();
  p.hset(gameKey(rid), {
    status: "waiting",
    size: String(size),
    board: boardToString(board),
    turn: "black",
    black: "",
    white: "",
    winner: "",
    lastX: "",
    lastY: "",
  });
  p.del(readyKey(rid)); // ready HASH 통째로 삭제
  p.hset(roomKey(rid), { status: "waiting" });
  await p.exec();

  const g2 = await redis.hgetall(gameKey(rid));
  const game = publicGame(g2);

  io.to(roomSockKey(rid)).emit("room:ready", { roomId: rid, readyMap: {} });
  io.to(roomSockKey(rid)).emit("game:state", { roomId: rid, game });
  io.to(LOBBY_ROOM).emit("rooms:changed", { roomId: rid });
}

// ------------------ lobby helpers ------------------
async function lobbyEnter(name, socket) {
  socket.join(LOBBY_ROOM);

  const p = redis.pipeline();
  p.sadd(lobbySocketsKey(name), socket.id);
  p.expire(lobbySocketsKey(name), 60 * 60);
  p.sadd(lobbyUsersKey, name);
  await p.exec();

  io.to(LOBBY_ROOM).emit("lobby:changed");
}
async function lobbyLeave(name, socket) {
  socket.leave(LOBBY_ROOM);

  await redis.srem(lobbySocketsKey(name), socket.id);
  const left = await redis.scard(lobbySocketsKey(name));
  if (left <= 0) {
    console.log("로비에서 제거")
    const p = redis.pipeline();
    p.del(lobbySocketsKey(name));
    p.srem(lobbyUsersKey, name);
    await p.exec();
  } else {
    console.log("실패");
  }

  io.to(LOBBY_ROOM).emit("lobby:changed");
}
async function isInLobby(name) {
  const count = await redis.scard(lobbySocketsKey(name));
  return count > 0;
}

// ------------------ room cleanup ------------------
// 게임은 자동 리셋"
async function cleanupRoom({ socket, rid, reason }) {
  const name = socket.data.userId;
  if (!rid) return;

  if (socket.data.cleanedRoomId === rid) return;
  socket.data.cleanedRoomId = rid;

  const room = await redis.hgetall(roomKey(rid));
  if (!room?.id) {
    socket.data.roomId = null;
    return;
  }

  const isOwner = room.ownerId === name;

  if (isOwner) {
    // 방장이 나가면 방 삭제(기존 유지)
    const p = redis.pipeline();
    p.del(roomKey(rid));
    p.del(membersKey(rid));
    p.del(readyKey(rid));
    p.del(gameKey(rid));
    p.del(roomChatKey(rid));
    p.zrem("rooms", rid);
    await p.exec();

    io.to(roomSockKey(rid)).emit("room:closed", { roomId: rid, reason });
    io.to(LOBBY_ROOM).emit("rooms:changed", { roomId: rid });
  } else {
    // 일반 유저 나감: 멤버 제거
    const p = redis.pipeline();
    p.srem(membersKey(rid), name);
    p.hdel(readyKey(rid), name); // 혹시 ready 찍혀있으면 제거
    await p.exec();

    // 자동 리셋: 게임/ready/status 모두 waiting으로
    await resetGameToWaiting(rid);

    io.to(roomSockKey(rid)).emit("room:member_left", {
      roomId: rid,
      name,
      reason,
    });
  }

  socket.data.roomId = null;
}

// ------------------ auth middleware ------------------
io.use(async (socket, next) => {
  try {
    const wsToken = socket.handshake.auth?.token;

    if (!wsToken) {
      socket.data.isGuest = true;
      socket.data.userId = null;
      socket.data.username = null;
      return next();
    }

    const raw = await redis.get(wsTicketKey(wsToken));
    if (!raw) return next(new Error("invalid_or_expired_ws_token"));

    const payload = JSON.parse(raw);
    if (!payload?.username) {
      await redis.del(wsTicketKey(wsToken));
      return next(new Error("bad_ws_token_payload"));
    }

    await redis.del(wsTicketKey(wsToken)); 

    socket.data.isGuest = false;
    socket.data.userId = String(payload.username);
    socket.data.username = String(payload.username);

    next();
  } catch (e) {
    next(new Error("ws_auth_failed"));
  }
});


io.on("connection", (socket) => {
  const isGuest = !!socket.data.isGuest;
  const name = socket.data.userId;
  let hb = null;
  if (isGuest) {
    socket.join(LOBBY_ROOM);
  } else {
    socket.join(userRoom(name));
    lobbyEnter(name, socket).catch(console.error);

    bumpPresence(name, socket.id).catch(console.error);
    hb = setInterval(() => {
      bumpPresence(name, socket.id).catch(() => {});
    }, HEARTBEAT_SEC * 1000);
  }
  // -------- lobby --------
  socket.on("lobby:join", async (_, ack) => {
    try {
      await lobbyEnter(name, socket);
      ack && ack({ ok: true });
    } catch {
      ack && ack({ ok: false, error: "lobby_join_failed" });
    }
  });

  socket.on("lobby:leave", async (_, ack) => {
    try {
      await lobbyLeave(name, socket);
      ack && ack({ ok: true });
    } catch {
      ack && ack({ ok: false, error: "lobby_leave_failed" });
    }
  });

  socket.on("lobby:sync", async (_, ack) => {
    try {
      const users = await redis.smembers(lobbyUsersKey);
      users.sort();
      ack && ack({ ok: true, users });
    } catch {
      ack && ack({ ok: false, error: "lobby_sync_failed" });
    }
  });

  socket.on("lobby:chat", async ({ text } = {}, ack) => {
    try {
      const msg = String(text ?? "").trim();
      if (!msg) throw new Error("empty_message");
      if (msg.length > 500) throw new Error("too_long");
      if (!socket.rooms.has(LOBBY_ROOM)) throw new Error("not_in_lobby");

      io.to(LOBBY_ROOM).emit("lobby:chat", {
        from: name,
        text: msg,
        ts: Date.now(),
      });

      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "chat_failed" });
    }
  });

  // -------- invite (방장만) --------
  socket.on("invite:send", async ({ to, roomId } = {}, ack) => {
    try {
      const target = String(to ?? "").trim();
      const rid = String(roomId ?? "").trim();
      if (!target || !rid) throw new Error("bad_payload");
      if (target === name) throw new Error("cannot_invite_self");

      const room = await redis.hgetall(roomKey(rid));
      if (!room?.id) throw new Error("room_not_found");
      if (room.ownerId !== name) throw new Error("not_room_owner");

      const maxPlayers = Number(room.maxPlayers || 2);
      const count = await redis.scard(membersKey(rid));
      if (count >= maxPlayers) throw new Error("room_full");

      const ok = await isInLobby(target);
      if (!ok) throw new Error("target_not_in_lobby");

      io.to(userRoom(target)).emit("invite:received", {
        from: name,
        roomId: rid,
        ts: Date.now(),
      });

      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "invite_failed" });
    }
  });

  // -------- room:sync --------
  socket.on("room:sync", async ({ roomId } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      if (!rid) throw new Error("roomId_required");

      const room = await redis.hgetall(roomKey(rid));
      if (!room?.id) throw new Error("room_not_found");

      const { members, readyMap } = await buildReadyMap(rid);

      const g = await getOrInitGame(rid);
      const game = publicGame(g);

      let chat = [];
      try {
        const raw = await redis.lrange(roomChatKey(rid), -CHAT_KEEP, -1);
        chat = raw.map((s) => JSON.parse(s)).filter(Boolean);
      } catch {
        chat = [];
      }

      const isOwner = (room.ownerId || "") === name;

      ack &&
        ack({
          ok: true,
          room: {
            id: room.id,
            title: room.title || "",
            status: room.status || "waiting",
            maxPlayers: Number(room.maxPlayers || 2),
          },
          ownerId: room.ownerId || "",
          members,
          readyMap,
          game,
          chat,
          isOwner,
          me: name,
        });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "sync_failed" });
    }
  });

  // -------- game:ready (레디 토글) --------
  socket.on("game:ready", async ({ roomId } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      if (!rid) throw new Error("roomId_required");
      if (socket.data.roomId !== rid) throw new Error("not_in_room");

      // 게임이 playing이면 ready 못누르게(원하면 제거 가능)
      const g = await getOrInitGame(rid);
      if ((g.status || "waiting") === "playing") throw new Error("game_playing");

      const cur = await redis.hget(readyKey(rid), name);
      const next = cur === "1" ? "0" : "1";
      await redis.hset(readyKey(rid), name, next);

      const { members, readyMap } = await buildReadyMap(rid);

      io.to(roomSockKey(rid)).emit("room:ready", { roomId: rid, readyMap });
      ack && ack({ ok: true, members, readyMap });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "ready_failed" });
    }
  });

  // -------- room:join --------
  socket.on("room:join", async ({ roomId } = {}, ack) => {
    try {
      const rid = String(roomId ?? "").trim();
      if (!rid) throw new Error("roomId_required");

      const room = await redis.hgetall(roomKey(rid));
      if (!room?.id) throw new Error("room_not_found");

      const maxPlayers = Number(room.maxPlayers || 2);
      const count = await redis.scard(membersKey(rid));
      if (count >= maxPlayers) throw new Error("room_full");

      await redis.sadd(membersKey(rid), name);

      await lobbyLeave(name, socket).catch(() => {});
      socket.join(roomSockKey(rid));

      socket.data.roomId = rid;
      socket.data.cleanedRoomId = null;

      const isOwner = room.ownerId === name;

      const { members, readyMap } = await buildReadyMap(rid);

      const g = await getOrInitGame(rid);
      const game = publicGame(g);

      let chat = [];
      try {
        const raw = await redis.lrange(roomChatKey(rid), -CHAT_KEEP, -1);
        chat = raw.map((s) => JSON.parse(s)).filter(Boolean);
      } catch {
        chat = [];
      }

      ack &&
        ack({
          ok: true,
          room: {
            id: room.id,
            title: room.title || "",
            status: room.status || "waiting",
            maxPlayers,
          },
          isOwner,
          ownerId: room.ownerId || "",
          members,
          readyMap,
          game,
          chat,
          me: name,
        });

      socket.to(roomSockKey(rid)).emit("room:member_joined", { roomId: rid, name });
      io.to(LOBBY_ROOM).emit("rooms:changed", { roomId: rid });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "join_failed" });
    }
  });

  // -------- room:leave --------
  socket.on("room:leave", async ({ roomId } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      if (!rid) {
        ack && ack({ ok: true });
        return;
      }

      socket.leave(roomSockKey(rid));
      await cleanupRoom({ socket, rid, reason: "leave" });

      await lobbyEnter(name, socket).catch(() => {});
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "leave_failed" });
    }
  });

  // -------- room:chat --------
  socket.on("room:chat", async ({ roomId, text } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      const msg = String(text ?? "").trim();
      if (!rid) throw new Error("roomId_required");
      if (!msg) throw new Error("empty_message");
      if (msg.length > 500) throw new Error("too_long");
      if (socket.data.roomId !== rid) throw new Error("not_in_room");

      const payload = { roomId: rid, from: name, text: msg, ts: Date.now() };

      await redis.rpush(roomChatKey(rid), JSON.stringify(payload));
      await redis.ltrim(roomChatKey(rid), -CHAT_KEEP, -1);

      io.to(roomSockKey(rid)).emit("room:chat", payload);
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "room_chat_failed" });
    }
  });

  // -------- game:start (방장만) --------
  socket.on("game:start", async ({ roomId } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      if (!rid) throw new Error("roomId_required");
      if (socket.data.roomId !== rid) throw new Error("not_in_room");

      const room = await redis.hgetall(roomKey(rid));
      if (!room?.id) throw new Error("room_not_found");
      if (room.ownerId !== name) throw new Error("not_room_owner");

      // 멤버
      const members = await redis.smembers(membersKey(rid));
      if (members.length < 2) throw new Error("need_2_players");

      // ready
      const readyRaw = await redis.hgetall(readyKey(rid));
      const readyMembers = members.filter((m) => readyRaw?.[m] === "1");
      if (readyMembers.length < 2) throw new Error("not_enough_ready");

      // ready한 사람 중 앞 2명
      const black = readyMembers[0];
      const white = readyMembers[1];

      // 게임 세팅
      const size = GAME_SIZE;
      const board = emptyBoard(size);

      const p = redis.pipeline();
      p.hset(gameKey(rid), {
        status: "playing",
        size: String(size),
        board: boardToString(board),
        turn: "black",
        black,
        white,
        winner: "",
        lastX: "",
        lastY: "",
      });
      p.del(readyKey(rid));
      p.hset(roomKey(rid), { status: "playing" });
      await p.exec();

      const g2 = await redis.hgetall(gameKey(rid));
      const game = publicGame(g2);

      io.to(roomSockKey(rid)).emit("room:ready", { roomId: rid, readyMap: {} });
      io.to(roomSockKey(rid)).emit("game:state", { roomId: rid, game });
      io.to(LOBBY_ROOM).emit("rooms:changed", { roomId: rid });

      ack && ack({ ok: true, game });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "start_failed" });
    }
  });

  // -------- omok: move --------
  function inRange(x, y, size) {
    return x >= 0 && y >= 0 && x < size && y < size;
  }
  function checkWin(board, x, y, color) {
    const size = board.length;
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];
    for (const [dx, dy] of dirs) {
      let cnt = 1;

      let i = 1;
      while (inRange(x + dx * i, y + dy * i, size) && board[y + dy * i][x + dx * i] === color) {
        cnt++;
        i++;
      }
      i = 1;
      while (inRange(x - dx * i, y - dy * i, size) && board[y - dy * i][x - dx * i] === color) {
        cnt++;
        i++;
      }

      if (cnt >= 5) return true;
    }
    return false;
  }

  socket.on("game:move", async ({ roomId, x, y } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      if (!rid) throw new Error("roomId_required");
      if (socket.data.roomId !== rid) throw new Error("not_in_room");

      const g = await getOrInitGame(rid);
      const game = publicGame(g);

      if (game.status !== "playing") throw new Error("game_not_playing");

      const myColor =
        game.black === name ? "black" : game.white === name ? "white" : "";
      if (!myColor) throw new Error("not_a_player");
      if (game.turn !== myColor) throw new Error("not_your_turn");

      const bx = Number(x),
        by = Number(y);
      if (!Number.isInteger(bx) || !Number.isInteger(by)) throw new Error("bad_xy");
      if (!inRange(bx, by, game.size)) throw new Error("out_of_range");

      const board = game.board;
      if (board[by][bx] !== 0) throw new Error("already_filled");

      const colorVal = myColor === "black" ? 1 : 2;
      board[by][bx] = colorVal;

      let winner = "";
      if (checkWin(board, bx, by, colorVal)) {
        winner = myColor;
      }

      const nextTurn = myColor === "black" ? "white" : "black";
      const nextStatus = winner ? "ended" : "playing";

      const p = redis.pipeline();
      p.hset(gameKey(rid), {
        board: boardToString(board),
        turn: winner ? game.turn : nextTurn,
        status: nextStatus,
        winner: winner,
        lastX: String(bx),
        lastY: String(by),
      });
      if (nextStatus === "ended") {
        p.hset(roomKey(rid), { status: "ended" });
      }
      await p.exec();

      const g2 = await redis.hgetall(gameKey(rid));
      const updated = publicGame(g2);

      io.to(roomSockKey(rid)).emit("game:state", { roomId: rid, game: updated });

      ack && ack({ ok: true, game: updated });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "move_failed" });
    }
  });

  // -------- game:reset (방장만) --------
  socket.on("game:reset", async ({ roomId } = {}, ack) => {
    try {
      const rid = String(roomId ?? socket.data.roomId ?? "").trim();
      if (!rid) throw new Error("roomId_required");
      if (socket.data.roomId !== rid) throw new Error("not_in_room");

      const room = await redis.hgetall(roomKey(rid));
      if (!room?.id) throw new Error("room_not_found");
      if (room.ownerId !== name) throw new Error("not_room_owner");

      // reset = waiting으로 완전 초기화 (너가 원하는 “자동리셋”과 같은 규칙)
      await resetGameToWaiting(rid);

      const g2 = await redis.hgetall(gameKey(rid));
      const game = publicGame(g2);

      ack && ack({ ok: true, game });
    } catch (e) {
      ack && ack({ ok: false, error: e.message || "reset_failed" });
    }
  });

  // -------- disconnecting --------
socket.on("disconnecting", async (reason) => {

  if (hb) clearInterval(hb);

  const isGuest = !!socket.data.isGuest;
  if (isGuest) return;
  console.log("disconnecting 감지", socket.id, reason);

  const name = socket.data.userId;
  const rid = socket.data.roomId;

  try {
    if (rid) {
      await cleanupRoom({ socket, rid, reason: "disconnect" });
    }
  } catch (e) {
    console.error("[disconnecting cleanupRoom error]", e);
  }

  try {
    await redis.srem(lobbySocketsKey(name), socket.id);

    const left = await redis.scard(lobbySocketsKey(name));

    if (left <= 0) {
      const p = redis.pipeline();
      p.del(lobbySocketsKey(name));
      p.srem(lobbyUsersKey, name);
      await p.exec();

      io.to(LOBBY_ROOM).emit("lobby:changed");
      console.log("로비에서 유저 제거:", name);
    } else {
      console.log("로비 소켓 남음:", name, left);
    }
  } catch (e) {
    console.error("[disconnecting lobby cleanup error]", e);
  }

  try {
    await maybeClearPresence(name, socket.id);
  } catch (e) {
    console.error("[disconnecting presence cleanup error]", e);
  }
});
});

httpServer.listen(PORT, () => {
  console.log(`WS listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${WEB_ORIGIN}`);
  console.log(`Redis: ${REDIS_URL}`);
});
