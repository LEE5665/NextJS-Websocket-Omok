"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "@/components/AuthProvider";

const SocketContext = createContext(null);

export function useSocket() {
  return useContext(SocketContext);
}

export default function SocketProvider({ children }) {
  const { user, loading, api } = useAuth(); // AuthProvider의 axios 공유 사용
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    // 아직 /me 로딩 중이면 아무것도 안 함
    if (loading) return;

    // 로그인 안 되어 있으면 소켓 끊고 종료
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      return;
    }

    let alive = true;

    (async () => {
      try {
        // 로그인된 user가 있을 때만 ws-token 요청
        const { data } = await api.post("/api/ws-token");
        if (!data?.token) return;

        const s = io("http://localhost:4000", {
          auth: { token: data.token },
          transports: ["websocket"],
        });

        socketRef.current = s;
        if (!alive) return;

        setSocket(s);

        s.on("invite:received", (payload) => {
          console.log("invite:", payload);
        });

        s.on("connect_error", (e) => {
          console.error("socket connect_error:", e?.message);
        });
      } catch (e) {
        console.warn("SocketProvider init failed:", e?.message);
      }
    })();

    return () => {
      alive = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
    };
  }, [user, loading, api]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}
