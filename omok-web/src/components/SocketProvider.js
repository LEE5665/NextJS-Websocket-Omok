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
    if (loading) return;

    let alive = true;

    const cleanup = () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
    };

    (async () => {
      try {
        const url = process.env.NEXT_PUBLIC_WS_URL;
        if (socketRef.current?.connected || socketRef.current) {
          cleanup();
        }
        if (user) {
          const { data } = await api.post("/api/ws-token");
          const token = data?.token;
          if (!token) {
            if (!alive) return;
            cleanup();
            return;
          }

          const s = io(url, {
            auth: { token },
            transports: ["websocket"],
          });

          socketRef.current = s;
          if (!alive) return;

          setSocket(s);

          s.on("connect_error", (e) => {
            console.error("socket connect_error:", e?.message);
          });

          return;
        }

        const s = io(url, {
          auth: { guest: true },
          transports: ["websocket"],
        });

        socketRef.current = s;
        if (!alive) return;

        setSocket(s);

        s.on("connect_error", (e) => {
          console.error("socket connect_error (guest):", e?.message);
        });
      } catch (e) {
        console.warn("SocketProvider init failed:", e?.message);
        if (!alive) return;
        cleanup();
      }
    })();

    return () => {
      alive = false;
      cleanup();
    };
  }, [user, loading, api]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}
