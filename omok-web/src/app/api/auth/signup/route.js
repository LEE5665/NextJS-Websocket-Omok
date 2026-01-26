import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const username = body?.username?.trim();
    const password = body?.password;

    if (!username || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { username, password: passwordHash },
      select: { id: true, username: true, createdAt: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    console.error("[SIGNUP_ERROR]", e);
    return NextResponse.json(
      {
        error: "Signup failed",
        detail: e?.message ?? String(e),
        code: e?.code,
        meta: e?.meta,
      },
      { status: 500 }
    );
  }
}
