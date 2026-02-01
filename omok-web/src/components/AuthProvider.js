"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}

export function AuthProvider({ children, initialUser = null }) {
  const apiRef = useRef(
    axios.create({
      baseURL: "",
      withCredentials: true,
      headers: { "Content-Type": "application/json" },
      timeout: 8000,
    })
  );

  const [user, setUser] = useState(initialUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const meInFlight = useRef(null);

  const refreshMe = async () => {
    if (meInFlight.current) return meInFlight.current;

    meInFlight.current = (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiRef.current.get("/api/auth/me");
        const u = res?.data?.user ?? null;
        setUser(u);
        return u;
      } catch (e) {
        setUser(null);
        setError(e);
        return null;
      } finally {
        setLoading(false);
        meInFlight.current = null;
      }
    })();

    return meInFlight.current;
  };

  useEffect(() => {
    if (initialUser) return; 
    refreshMe();
  }, []);

  useEffect(() => {
    const api = apiRef.current;

    const id = api.interceptors.response.use(
      (res) => res,
      async (err) => {
        const status = err?.response?.status;
        const config = err?.config;

        if (!config) return Promise.reject(err);

        const url = String(config.url || "");
        const isMe = url.includes("/api/auth/me");

        if (status === 401 && !isMe && !config._retry) {
          config._retry = true;
          const u = await refreshMe();
          if (u) {
            return api(config);
          }
        }

        return Promise.reject(err);
      }
    );

    return () => api.interceptors.response.eject(id);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      refreshMe,
      api: apiRef.current,
    }),
    [user, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
