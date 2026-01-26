export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

export const cookieBase = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export const accessCookie = {
  ...cookieBase,
  maxAge: Number(process.env.ACCESS_TOKEN_TTL ?? "900"),
};

export const refreshCookie = {
  ...cookieBase,
  maxAge: Number(process.env.REFRESH_TOKEN_TTL ?? "1209600"),
};
