"use server";

import { redirect } from "next/navigation";
import { sql } from "@/app/lib/db";
import { hashPassword, verifyPassword } from "@/app/lib/password";
import { createSession, deleteSession } from "@/app/lib/session";

export type AuthFormState = { error: string } | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email)) return "邮箱格式不正确";
  if (password.length < 8) return "密码至少需要 8 位";
  return null;
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
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
