"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/components/SocketProvider";
import { useAuth } from "@/components/AuthProvider";

export default function HomePage() {
  const router = useRouter();
  const socket = useSocket();

  const { user: me, loading: loadingMe, api, refreshMe } = useAuth();

  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [errorRooms, setErrorRooms] = useState("");

  const [query, setQuery] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);

  // create room modal
  const [openCreate, setOpenCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrivate, setNewPrivate] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // lobby side
  const [lobbyUsers, setLobbyUsers] = useState([]);
  const [lobbyMsg, setLobbyMsg] = useState([]);
  const [chatText, setChatText] = useState("");
  const [inviteToast, setInviteToast] = useState(null); // {from, roomId, ts}

  // ---- rooms ----
  async function fetchRooms() {
    setLoadingRooms(true);
    setErrorRooms("");
    try {
      const { data } = await api.get("/api/rooms");
      setRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    } catch {
      setRooms([]);
      setErrorRooms("오류가 있어요.");
    } finally {
      setLoadingRooms(false);
    }
  }

  useEffect(() => {
    fetchRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms
      .filter((r) => {
        if (!q) return true;
        return String(r.title ?? "").toLowerCase().includes(q);
      })
      .filter((r) => {
        if (!onlyWaiting) return true;
        return (r.status ?? "waiting") === "waiting";
      });
  }, [rooms, query, onlyWaiting]);

  // ---- auth ----
  async function onLogout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignore
    } finally {
      // 전역 상태 갱신 (user=null로 바뀌면 SocketProvider가 자동 disconnect)
      await refreshMe();
    }
  }

  // ---- create room ----
  async function onCreateRoom() {
    const title = newTitle.trim();
    if (!title) return;

    const { data } = await api.post("/api/rooms", {
      title,
      isPrivate: newPrivate,
      password: newPrivate ? newPassword : "",
    });

    if (!data?.ok) return alert("방 생성 실패");
    router.push(`/room/${data.roomId}`);
  }

  // ---- lobby socket wiring ----
  useEffect(() => {
    if (!socket) return;

    const syncLobby = () => {
      socket.emit("lobby:sync", {}, (ack) => {
        if (ack?.ok) setLobbyUsers(Array.isArray(ack.users) ? ack.users : []);
      });
    };

    const onChanged = () => syncLobby();
    const onLobbyChat = (m) => {
      setLobbyMsg((prev) => [...prev, m].slice(-100));
    };
    const onInvite = (inv) => setInviteToast(inv);

    let t;
    const onRoomsChanged = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        fetchRooms();
      }, 150);
    };

    socket.on("lobby:changed", onChanged);
    socket.on("lobby:chat", onLobbyChat);
    socket.on("invite:received", onInvite);
    socket.on("rooms:changed", onRoomsChanged);

    // 로비 입장 + 초기 sync
    socket.emit("lobby:join", {}, () => { });
    syncLobby();

    return () => {
      socket.off("lobby:changed", onChanged);
      socket.off("lobby:chat", onLobbyChat);
      socket.off("invite:received", onInvite);
      socket.off("rooms:changed", onRoomsChanged);
      clearTimeout(t);
    };
  }, [socket]);

  // ---- lobby actions ----
  function sendLobbyChat() {
    if (!socket) return;
    if (!me) return alert("로그인이 필요해요.");

    const text = chatText.trim();
    if (!text) return;

    socket.emit("lobby:chat", { text }, (ack) => {
      if (ack?.ok) setChatText("");
      else alert(ack?.error || "chat_failed");
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-slate-800" />
            <div className="leading-tight">
              <div className="text-sm text-slate-300">오목</div>
              <div className="text-lg font-semibold">로비</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {loadingMe ? (
              <div className="text-sm text-slate-400">로그인 확인중…</div>
            ) : me ? (
              <>
                <div className="hidden text-sm text-slate-300 sm:block">
                  <span className="text-slate-500">Signed in as </span>
                  <span className="font-medium text-slate-100">{me.username}</span>
                </div>
                <button
                  onClick={() => setOpenCreate(true)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
                >
                  방 만들기
                </button>
                <button
                  onClick={onLogout}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <a
                  href="/login"
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
                >
                  로그인
                </a>
                <a
                  href="/signup"
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
                >
                  회원가입
                </a>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          {/* Rooms */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">방 목록</h1>
                <p className="mt-1 text-sm text-slate-400">공개/비공개 방을 찾아 입장하세요.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchRooms}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
                >
                  새로고침
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="방 제목 검색…"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                />
              </div>
              <label className="flex select-none items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={onlyWaiting}
                  onChange={(e) => setOnlyWaiting(e.target.checked)}
                  className="h-4 w-4 accent-slate-200"
                />
                대기중만
              </label>
            </div>

            {/* Rooms list */}
            <div className="mt-5">
              {loadingRooms ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-sm text-slate-400">
                  방 목록 불러오는 중…
                </div>
              ) : errorRooms ? (
                <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-6 text-sm text-amber-200">
                  {errorRooms}
                </div>
              ) : filteredRooms.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-sm text-slate-400">
                  조건에 맞는 방이 없어요.
                </div>
              ) : (
                <ul className="grid gap-3">
                  {filteredRooms.map((r) => {
                    const status = r.status ?? "waiting";
                    const isFull = Number(r.onlineCount ?? 0) >= Number(r.maxPlayers ?? 2);
                    const isPlaying = status === "playing";
                    return (
                      <li
                        key={r.id}
                        className="rounded-2xl border border-slate-800 bg-slate-950 p-4 hover:bg-slate-900/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-base font-semibold">{r.title}</h3>
                              {r.isPrivate ? (
                                <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
                                  비공개
                                </span>
                              ) : (
                                <span className="rounded-full border border-slate-800 px-2 py-0.5 text-xs text-slate-400">
                                  공개
                                </span>
                              )}
                              <span className="rounded-full border border-slate-800 px-2 py-0.5 text-xs text-slate-400">
                                {(() => {
                                  const status = r.status ?? "waiting";
                                  return status === "waiting"
                                    ? "대기"
                                    : status === "playing"
                                      ? "진행"
                                      : status === "ended"
                                        ? "종료"
                                        : "알수없음";
                                })()}
                              </span>
                            </div>

                            <div className="mt-1 text-sm text-slate-400">
                              인원{" "}
                              <span className="text-slate-200">{r.onlineCount ?? 0}</span>/
                              {r.maxPlayers ?? 2}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!me || isFull || isPlaying}
                              title={
                                !me
                                  ? "로그인이 필요해요"
                                  : isFull
                                    ? "인원이 가득 찼어요"
                                    : isPlaying
                                      ? "게임 진행 중인 방은 입장할 수 없어요"
                                      : "입장"
                              }
                              onClick={() => router.push(`/room/${r.id}`)}
                            >
                              입장
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Right side */}
          <aside className="space-y-6">
            {/* Lobby chat */}
            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <h2 className="text-base font-semibold">로비 채팅</h2>

              <div className="mt-3 h-48 overflow-auto rounded-xl border border-slate-800 p-3 text-sm">
                {lobbyMsg.length === 0 ? (
                  <div className="text-slate-500">아직 메시지 없음</div>
                ) : (
                  <div className="space-y-2">
                    {lobbyMsg.map((m, idx) => (
                      <div key={idx} className="break-words">
                        <span className="text-slate-400">{m.from}:</span>{" "}
                        <span className="text-slate-100">{m.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendLobbyChat();
                  }}
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                  placeholder="메시지..."
                  disabled={!me}
                />
                <button
                  onClick={sendLobbyChat}
                  disabled={!me}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                >
                  전송
                </button>
              </div>
            </section>

            {/* Invite toast */}
            {inviteToast ? (
              <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
                <h2 className="text-base font-semibold">초대 도착</h2>
                <div className="mt-2 text-sm text-slate-300">
                  <span className="text-slate-400">{inviteToast.from}</span> 님이{" "}
                  <span className="text-slate-100">{inviteToast.roomId}</span> 방으로 초대했어요.
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900"
                    onClick={() => {
                      const rid = inviteToast.roomId;
                      setInviteToast(null);
                      router.push(`/room/${rid}`);
                    }}
                  >
                    수락
                  </button>
                  <button
                    className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
                    onClick={() => setInviteToast(null)}
                  >
                    닫기
                  </button>
                </div>
              </section>
            ) : null}

            {/* Status */}
            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <h2 className="text-base font-semibold">상태</h2>
              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm">
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-slate-400">방 개수</span>
                  <span className="text-slate-100">{rooms.length}</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* Create Room Modal */}
      {openCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">방 만들기</h3>
                <p className="mt-1 text-sm text-slate-400">공개/비공개를 선택할 수 있어요.</p>
              </div>
              <button
                onClick={() => setOpenCreate(false)}
                className="rounded-xl border border-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-900"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">제목</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="예) 초보 환영"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                />
              </div>

              <label className="flex select-none items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-200">
                비공개 방
                <input
                  type="checkbox"
                  checked={newPrivate}
                  onChange={(e) => setNewPrivate(e.target.checked)}
                  className="h-4 w-4 accent-slate-200"
                />
              </label>

              {newPrivate && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">방 비밀번호</label>
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    * 서버에서는 원문 저장 말고 해시로만 저장할 예정.
                  </p>
                </div>
              )}

              <button
                disabled={!me || !newTitle.trim()}
                onClick={onCreateRoom}
                className="mt-2 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                만들기
              </button>

              {!me && <div className="text-xs text-slate-500">방 만들기는 로그인 후 가능해요.</div>}
            </div>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-slate-600">
        © {new Date().getFullYear()} Omok Lobby
      </footer>
    </div>
  );
}
