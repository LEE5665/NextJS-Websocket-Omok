"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/components/SocketProvider";

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const socket = useSocket();

  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");

  // room meta
  const [roomName, setRoomName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [members, setMembers] = useState([]);
  const [isOwner, setIsOwner] = useState(false);

  // ready: { username: true/false }
  const [readyMap, setReadyMap] = useState({});

  // invite modal
  const [openInvite, setOpenInvite] = useState(false);
  const [lobbyUsers, setLobbyUsers] = useState([]);
  const [inviteQuery, setInviteQuery] = useState("");

  // chat
  const [chatText, setChatText] = useState("");
  const [roomMsg, setRoomMsg] = useState([]);

  // chat auto scroll
  const chatBoxRef = useRef(null);
  const chatBottomRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // game
  const [game, setGame] = useState(null);
  const [gameErr, setGameErr] = useState("");

  const size = game?.size || 15;

  const gameEnded = !!(game?.winner || game?.ended || game?.status === "ended");
  const gamePlaying = game?.status === "playing";
  const readyCount = members.filter((u) => !!readyMap?.[u]).length;

  // 시작 조건: 방장 + 2명 레디 + 게임 진행중/종료 아님
  const canStart =
    isOwner && members.length >= 2 && readyCount >= 2 && !gamePlaying && !gameEnded;

  const [meName, setMeName] = useState("");
  const myReady = meName ? !!readyMap?.[meName] : false;

  const applyRoomSnapshot = (ack) => {
    const title = ack?.room?.title || ack?.room?.title;
    if (title) setRoomName(title);

    if (ack?.ownerId != null) setOwnerId(ack.ownerId || "");
    if (Array.isArray(ack?.members)) setMembers(ack.members);

    if (typeof ack?.isOwner === "boolean") setIsOwner(ack.isOwner);

    if (ack?.readyMap && typeof ack.readyMap === "object") setReadyMap(ack.readyMap);
    if (Array.isArray(ack?.chat)) setRoomMsg(ack.chat);
    if ("game" in (ack || {})) setGame(ack.game ?? null);

    if (ack?.me) setMeName(String(ack.me));
  };

  const syncRoom = () => {
    if (!socket) return;
    socket.emit("room:sync", { roomId }, (ack) => {
      if (!ack?.ok) return;
      applyRoomSnapshot(ack);
    });
  };

  const syncLobbyUsers = () => {
    if (!socket) return;
    socket.emit("lobby:sync", {}, (ack) => {
      if (ack?.ok) setLobbyUsers(Array.isArray(ack.users) ? ack.users : []);
    });
  };

  useEffect(() => {
    if (!socket || !roomId) return;

    setStatus("joining");
    setError("");

    socket.emit("room:join", { roomId }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || "join_failed");
        setStatus("error");
        return;
      }

      applyRoomSnapshot(ack);
      setStatus("joined");
    });

    return () => {
      socket.emit("room:leave", { roomId }, () => {});
    };
  }, [socket, roomId]);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onJoined = ({ roomId: rid, name }) => {
      if (rid !== roomId) return;
      setMembers((prev) => (prev.includes(name) ? prev : [...prev, name]));
      syncRoom();
    };

    const onLeft = ({ roomId: rid, name }) => {
      if (rid !== roomId) return;
      setMembers((prev) => prev.filter((x) => x !== name));
      syncRoom();
    };

    const onClosed = ({ roomId: rid }) => {
      if (rid !== roomId) return;
      router.push("/");
    };

    const onRoomChat = (m) => {
      if (m?.roomId !== roomId) return;
      setRoomMsg((prev) => [...prev, m].slice(-100));
    };

    const onGameState = ({ roomId: rid, game: nextGame }) => {
      if (rid !== roomId) return;
      setGame(nextGame);
    };

    const onReady = ({ roomId: rid, readyMap: next }) => {
      if (rid !== roomId) return;
      if (next && typeof next === "object") setReadyMap(next);
    };

    const onRoomMeta = ({ roomId: rid, title }) => {
      if (rid !== roomId) return;
      if (title) setRoomName(title);
    };

    socket.on("room:member_joined", onJoined);
    socket.on("room:member_left", onLeft);
    socket.on("room:closed", onClosed);
    socket.on("room:chat", onRoomChat);
    socket.on("game:state", onGameState);
    socket.on("room:ready", onReady);
    socket.on("room:meta", onRoomMeta);

    return () => {
      socket.off("room:member_joined", onJoined);
      socket.off("room:member_left", onLeft);
      socket.off("room:closed", onClosed);
      socket.off("room:chat", onRoomChat);
      socket.off("game:state", onGameState);
      socket.off("room:ready", onReady);
      socket.off("room:meta", onRoomMeta);
    };
  }, [socket, roomId, router]);

  useEffect(() => {
    if (!socket || !roomId || !isOwner) return;

    const onLobbyChanged = () => {
      if (openInvite) syncLobbyUsers();
    };

    socket.on("lobby:changed", onLobbyChanged);
    return () => socket.off("lobby:changed", onLobbyChanged);
  }, [socket, roomId, isOwner, openInvite]);

  useEffect(() => {
    if (!autoScroll) return;
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMsg.length, autoScroll]);

  function openInviteModal() {
    setOpenInvite(true);
    syncLobbyUsers();
  }

  function sendInvite(toUsername) {
    if (!socket) return;
    socket.emit("invite:send", { to: toUsername, roomId }, (ack) => {
      if (!ack?.ok) alert(ack?.error || "invite_failed");
      else alert(`${toUsername}님에게 초대를 보냈어요.`);
    });
  }

  function startGame() {
    if (!socket) return;

    socket.emit("game:start", { roomId }, (ack) => {
      if (!ack?.ok) alert(ack?.error || "start_failed");
      else if (ack.game) setGame(ack.game);
    });
  }

  function sendRoomChat() {
    if (!socket) return;
    const text = chatText.trim();
    if (!text) return;

    socket.emit("room:chat", { roomId, text }, (ack) => {
      if (ack?.ok) setChatText("");
      else alert(ack?.error || "chat_failed");
    });
  }

  function toggleReady() {
    if (!socket) return;

    socket.emit("game:ready", { roomId }, (ack) => {
      if (!ack?.ok) alert(ack?.error || "ready_failed");
      else {
        if (ack.readyMap) setReadyMap(ack.readyMap);
        if (ack.game) setGame(ack.game);
      }
    });
  }

  function replayGame() {
    if (!socket) return;
    setGameErr("");

    socket.emit("game:reset", { roomId }, (ack) => {
      if (!ack?.ok) setGameErr(ack?.error || "reset_failed");
      else setGame(ack.game);
    });
  }

  function onClickCell(x, y) {
    if (!socket) return;
    if (!game?.board) return;
    if (gameEnded || (gamePlaying === false && game?.status === "ended")) return;

    if (!gamePlaying) return;

    setGameErr("");
    socket.emit("game:move", { roomId, x, y }, (ack) => {
      if (!ack?.ok) setGameErr(ack?.error || "move_failed");
      else setGame(ack.game);
    });
  }

  const filteredLobbyUsers = useMemo(() => {
    const q = inviteQuery.trim().toLowerCase();
    const base = lobbyUsers.filter((u) => u);
    if (!q) return base;
    return base.filter((u) => String(u).toLowerCase().includes(q));
  }, [lobbyUsers, inviteQuery]);

  if (!socket)
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-6">소켓 준비중…</div>;
  if (status === "joining" || status === "connecting")
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-6">입장중…</div>;
  if (status === "error")
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-6">오류: {error}</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="leading-tight">
            <div className="text-sm text-slate-300">오목</div>
            <div className="text-lg font-semibold">{roomName ? roomName : `Room ${roomId}`}</div>
            <div className="mt-0.5 text-xs text-slate-500">ID: {roomId}</div>
          </div>

          <div className="flex items-center gap-2">
            {isOwner ? (
              <button
                onClick={openInviteModal}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
              >
                초대
              </button>
            ) : null}
            <button
              onClick={() => router.push("/")}
              className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
            >
              나가기
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">참가자</h2>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleReady}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
                >
                  {myReady ? "레디 해제" : "레디"}
                </button>

                {isOwner && (
                  <button
                    onClick={startGame}
                    disabled={!canStart}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-50 disabled:hover:bg-transparent"
                    title={
                      canStart
                        ? "게임 시작"
                        : "시작 조건: 방장 + 2명 레디 + 게임이 진행중이 아니어야 함"
                    }
                  >
                    시작
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 text-xs text-slate-500">
              방장: <span className="text-slate-200">{ownerId || "(unknown)"}</span>
              <span className="ml-3">
                준비 {readyCount}/{members.length}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {members.length === 0 ? (
                <div className="text-sm text-slate-500">아직 없음</div>
              ) : (
                <ul className="space-y-2">
                  {members.map((name) => {
                    const isReady = !!readyMap?.[name];
                    const isGameBlack = game?.black === name;
                    const isGameWhite = game?.white === name;

                    return (
                      <li
                        key={name}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-100">
                            {name}
                            {name === ownerId ? (
                              <span className="ml-2 text-xs text-slate-500">(방장)</span>
                            ) : null}
                            {isGameBlack ? (
                              <span className="ml-2 text-xs text-slate-400">흑</span>
                            ) : null}
                            {isGameWhite ? (
                              <span className="ml-2 text-xs text-slate-400">백</span>
                            ) : null}
                          </div>
                        </div>

                        <span
                          className={[
                            "rounded-full border px-2 py-0.5 text-xs",
                            isReady
                              ? "border-emerald-700/60 text-emerald-200 bg-emerald-950/20"
                              : "border-slate-800 text-slate-500",
                          ].join(" ")}
                        >
                          {isReady ? "READY" : "NOT READY"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">오목</h2>

                <div className="flex gap-2">
                  {gameEnded && isOwner ? (
                    <button
                      onClick={replayGame}
                      className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
                    >
                      다시하기
                    </button>
                  ) : null}
                </div>
              </div>

              {gameEnded ? (
                <div className="mt-3 rounded-xl border border-amber-900/40 bg-amber-950/20 p-3 text-sm text-amber-200">
                  게임 끝!{" "}
                  {game?.winner ? (
                    <span className="text-amber-100 font-semibold">승리: {game.winner}</span>
                  ) : (
                    "종료"
                  )}
                </div>
              ) : null}

              {gameErr ? <div className="mt-3 text-sm text-red-300">{gameErr}</div> : null}

              {game?.board ? (
                <div className="mt-4 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div style={{ minWidth: size * 28 }}>
                    <div
                      className="grid gap-[1px] bg-slate-800/80"
                      style={{
                        gridTemplateColumns: `repeat(${size}, 28px)`,
                        width: size * 28,
                      }}
                    >
                      {game.board.map((row, y) =>
                        row.map((cell, x) => {
                          const stone = cell === 1 ? "●" : cell === 2 ? "○" : "";
                          const isLast = game.lastX === x && game.lastY === y;

                          return (
                            <button
                              key={`${x}-${y}`}
                              onClick={() => onClickCell(x, y)}
                              disabled={!gamePlaying || gameEnded}
                              className={[
                                "h-7 w-7 flex items-center justify-center text-sm",
                                "bg-[#f3d59b] text-black",
                                "hover:brightness-95",
                                !gamePlaying || gameEnded ? "cursor-not-allowed opacity-70" : "",
                              ].join(" ")}
                              title={`${x},${y}`}
                            >
                              <span className={isLast ? "font-black" : ""}>{stone}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-500">게임 준비중…</div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <h2 className="text-base font-semibold">채팅</h2>

              <div
                ref={chatBoxRef}
                onScroll={() => {
                  const el = chatBoxRef.current;
                  if (!el) return;
                  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  setAutoScroll(nearBottom);
                }}
                className="mt-3 h-56 overflow-auto rounded-xl border border-slate-800 p-3 text-sm"
              >
                {roomMsg.length === 0 ? (
                  <div className="text-slate-500">아직 메시지 없음</div>
                ) : (
                  <div className="space-y-2">
                    {roomMsg.map((m, idx) => (
                      <div key={idx} className="break-words">
                        <span className="text-slate-400">{m.from}:</span>{" "}
                        <span className="text-slate-100">{m.text}</span>
                      </div>
                    ))}
                    <div ref={chatBottomRef} />
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendRoomChat();
                  }}
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                  placeholder="메시지..."
                />
                <button
                  onClick={sendRoomChat}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
                >
                  전송
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {openInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">로비 유저 초대</h3>
                <p className="mt-1 text-sm text-slate-400">로비에 있는 유저에게 초대를 보냅니다.</p>
              </div>
              <button
                onClick={() => setOpenInvite(false)}
                className="rounded-xl border border-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-900"
              >
                닫기
              </button>
            </div>

            <div className="mt-4">
              <input
                value={inviteQuery}
                onChange={(e) => setInviteQuery(e.target.value)}
                placeholder="유저 검색…"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
              />
            </div>

            <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-800 p-3">
              {filteredLobbyUsers.length === 0 ? (
                <div className="text-sm text-slate-500">표시할 유저가 없어요.</div>
              ) : (
                <ul className="space-y-2">
                  {filteredLobbyUsers.map((u) => (
                    <li key={u} className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm text-slate-100">{u}</div>
                      <button
                        className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-white"
                        onClick={() => sendInvite(u)}
                      >
                        초대
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={syncLobbyUsers}
                className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
              >
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-slate-600">
        © {new Date().getFullYear()} Omok Room
      </footer>
    </div>
  );
}
