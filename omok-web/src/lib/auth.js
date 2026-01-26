import { SignJWT, jwtVerify } from "jose";

const enc = new TextEncoder();
const accessSecret = enc.encode(process.env.JWT_ACCESS_SECRET);
const refreshSecret = enc.encode(process.env.JWT_REFRESH_SECRET);

const accessTtl = Number(process.env.ACCESS_TOKEN_TTL ?? "900");
const refreshTtl = Number(process.env.REFRESH_TOKEN_TTL ?? "1209600");

export async function signAccessToken({ sub, username }) {
  return new SignJWT({ sub, username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${accessTtl}s`)
    .sign(accessSecret);
}

export async function signRefreshToken({ sub, username }) {
  return new SignJWT({ sub, username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${refreshTtl}s`)
    .sign(refreshSecret);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, accessSecret);
  return payload;
}

export async function verifyRefreshToken(token) {
  const { payload } = await jwtVerify(token, refreshSecret);
  return payload;
}
