import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookie,
} from "@/lib/cookies";
import {
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
} from "@/lib/auth";

export async function GET(req) {
  try {
    const access = req.cookies.get(ACCESS_COOKIE)?.value;

    if (access) {
      try {
        const payload = await verifyAccessToken(access);
        return NextResponse.json(
          { user: { id: payload.sub, username: payload.username } },
          { status: 200 }
        );
      } catch (e) {

      }
    }

    const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!refresh) return NextResponse.json({ user: null }, { status: 200 });

    const rp = await verifyRefreshToken(refresh);

    const payload = { sub: rp.sub, username: rp.username };

    const newAccess = await signAccessToken(payload);

    const res = NextResponse.json(
      { user: { id: payload.sub, username: payload.username } },
      { status: 200 }
    );

    res.cookies.set(ACCESS_COOKIE, newAccess, accessCookie);

    return res;
  } catch (e) {
    console.error("[ME_ERROR]", e);
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
