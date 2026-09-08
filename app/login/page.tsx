"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { login, signup, type AuthFormState } from "@/app/actions/auth";
import { btnPrimary, fieldClass, sectionLabel } from "@/app/ui/shared";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginState, loginAction, loginPending] = useActionState<AuthFormState, FormData>(
    login,
    undefined
  );
  const [signupState, signupAction, signupPending] = useActionState<AuthFormState, FormData>(
    signup,
    undefined
  );

  const state = mode === "login" ? loginState : signupState;
  const action = mode === "login" ? loginAction : signupAction;
  const pending = mode === "login" ? loginPending : signupPending;

  return (
    <div className="paper-grain min-h-screen bg-bg flex justify-center relative overflow-x-hidden">
      <div className="relative z-10 w-full max-w-[430px] flex flex-col min-h-screen px-5 pt-20 pb-8">
        <Link href="/" className="text-sm text-muted hover:text-ink mb-8">
          ← 返回
        </Link>

        <h1 className="font-serif text-3xl font-bold text-primary-deep mb-1">
          {mode === "login" ? "登录" : "注册"}
        </h1>
        <p className="text-[13px] text-muted mb-6">
          登录后，点开的词卡会自动记进生词本，方便复习。
        </p>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode("login")}
            className={`flex-1 rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors ${
              mode === "login"
                ? "border-primary bg-primary-light text-primary-deep"
                : "border-rim text-muted"
            }`}
          >
            登录
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors ${
              mode === "signup"
                ? "border-primary bg-primary-light text-primary-deep"
                : "border-rim text-muted"
            }`}
          >
            注册
          </button>
        </div>

        <form action={action} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>邮箱</span>
            <input
              className={fieldClass}
              type="email"
              name="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>密码</span>
            <input
              className={fieldClass}
              type="password"
              name="password"
              required
              minLength={8}
              placeholder={mode === "signup" ? "至少 8 位" : ""}
            />
          </label>

          {state?.error && <p className="text-xs text-[#B0503A]">{state.error}</p>}

          <button type="submit" disabled={pending} className={`${btnPrimary} mt-2`}>
            {pending ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}
          </button>
        </form>
      </div>
    </div>
  );
}
