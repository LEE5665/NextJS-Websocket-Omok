"use client";

import { useMemo, useState } from "react";
import axios from "axios";

export default function LoginPage() {
  const api = useMemo(
    () =>
      axios.create({
        baseURL: "",
        withCredentials: true, // HttpOnly 쿠키 받기/보내기
        headers: { "Content-Type": "application/json" },
        timeout: 8000,
      }),
    []
  );

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");

    const u = username.trim();
    if (!u || !password) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }

    try {
      setSubmitting(true);
      await api.post("/api/auth/login", { username: u, password });
      window.location.href = "/"; // 로비로
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        (err?.response?.status === 401
          ? "아이디 또는 비밀번호가 올바르지 않아요."
          : "로그인에 실패했어요. 잠시 후 다시 시도해주세요.");
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/80">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-5">
          <a href="/" className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-slate-800" />
            <div className="leading-tight">
              <div className="text-sm text-slate-300">오목</div>
              <div className="text-lg font-semibold">로비</div>
            </div>
          </a>
          <a
            href="/signup"
            className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
          >
            회원가입
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-sm">
          <h1 className="text-xl font-semibold">로그인</h1>
          <p className="mt-1 text-sm text-slate-400">
            로그인하면 방을 만들고 입장할 수 있어요.
          </p>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-900/40 bg-rose-950/20 p-4 text-sm text-rose-200">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">아이디</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                placeholder="아이디 입력"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                placeholder="비밀번호 입력"
              />
            </div>

            <button
              disabled={submitting}
              className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "로그인 중…" : "로그인"}
            </button>

            <div className="flex items-center justify-between text-xs text-slate-500">
              <a href="/" className="hover:text-slate-300">
                ← 로비로
              </a>
              <a href="/signup" className="hover:text-slate-300">
                계정이 없어요 (회원가입)
              </a>
            </div>
          </form>
        </div>
      </main>

      <footer className="mx-auto max-w-xl px-4 pb-10 text-xs text-slate-600">
        © {new Date().getFullYear()} Omok
      </footer>
    </div>
  );
}
