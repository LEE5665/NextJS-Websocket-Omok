"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { useParams } from "next/navigation";

export default function RoomPage() {
  const { id: roomId } = useParams()

  const api = useMemo(() => axios.create({
    baseURL: "",
    withCredentials: true,
    headers: { "Content-Type": "application/json" },
    timeout: 8000,
  }), []);

  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    let s;

    (async () => {
      try {
        // ws-token 발급(쿠키 검증)
        const { data } = await api.post("/api/ws-token");

        s = io("http://localhost:4000", {
          auth: { token: data.token },
          transports: ["websocket"],
        });

        s.on("connect", () => {
          s.emit("room:join", { roomId }, (ack) => {
            if (!ack?.ok) {
              setError(ack?.error || "join_failed");
              setStatus("error");
              return;
            }
            setStatus("joined");
          });
        });

        s.on("connect_error", (e) => {
          setError(e?.message || "connect_error");
          setStatus("error");
        });
      } catch (e) {
        setError("ws_token_failed");
        setStatus("error");
      }
    })();

    return () => {
      if (s) s.disconnect();
    };
  }, [api, roomId]);

  if (status === "connecting") return <div className="p-6">연결중…</div>;
  if (status === "error") return <div className="p-6">오류: {error}</div>;
  return <div className="p-6">방 입장 완료! roomId: {roomId}</div>;
}
