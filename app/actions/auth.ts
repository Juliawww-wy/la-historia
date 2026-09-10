"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { sql } from "@/app/lib/db";
import { hashPassword, verifyPassword } from "@/app/lib/password";
import { createSession, deleteSession } from "@/app/lib/session";
import { rateLimit, clientKeyFromHeaderGetter } from "@/app/api/_lib/rate-limit";

export type AuthFormState = { error: string } | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Soft shield against brute-force / credential stuffing / signup spam — same
// in-memory limiter used by the translate API (app/api/_lib/rate-limit.ts).
// Login is limited both per IP (blocks spray across many accounts) and per
// account (blocks hammering one account from many IPs); signup is per IP only.
const LOGIN_IP_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
const LOGIN_ACCOUNT_LIMIT = { limit: 6, windowMs: 10 * 60_000 };
const SIGNUP_IP_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientKeyFromHeaderGetter((name) => h.get(name));
}

function validate(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email)) return "邮箱格式不正确";
  if (password.length < 8) return "密码至少需要 8 位";
  return null;
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await clientIp();
  const limited = rateLimit(`signup:ip:${ip}`, SIGNUP_IP_LIMIT);
  if (!limited.ok) return { error: "注册请求过于频繁，请稍后再试" };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const validationError = validate(email, password);
  if (validationError) return { error: validationError };

  try {
    const passwordHash = hashPassword(password);
    const rows = (await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${passwordHash})
      RETURNING id
    `) as { id: string }[];

    await createSession(rows[0].id, email);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return { error: "这个邮箱已经注册过了，直接登录试试" };
    }
    console.error("注册失败:", err);
    return { error: "注册失败，请稍后重试" };
  }

  redirect("/");
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const ip = await clientIp();
  const ipLimited = rateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT);
  const accountLimited = rateLimit(`login:account:${email}`, LOGIN_ACCOUNT_LIMIT);
  if (!ipLimited.ok || !accountLimited.ok) {
    return { error: "登录尝试过于频繁，请稍后再试" };
  }

  if (!email || !password) return { error: "请输入邮箱和密码" };

  let userId: string;
  try {
    const rows = (await sql`
      SELECT id, password_hash FROM users WHERE email = ${email}
    `) as { id: string; password_hash: string }[];

    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return { error: "邮箱或密码不对" };
    }
    userId = user.id;
  } catch (err) {
    console.error("登录失败:", err);
    return { error: "登录失败，请稍后重试" };
  }

  await createSession(userId, email);
  redirect("/");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
