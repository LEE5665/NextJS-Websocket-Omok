import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "@/lib/cookies";
import { verifyAccessToken } from "@/lib/auth";

export async function getServerMe() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;

  if (!token) return null;

  try {
    const payload = await verifyAccessToken(token);
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}
