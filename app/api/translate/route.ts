import { NextRequest, NextResponse } from "next/server";
import { clientKeyFromRequest, rateLimit } from "../_lib/rate-limit";
import {
  getTranslateProvider,
  TranslateConfigError,
  TranslateRequestError,
} from "../_lib/translate";

/**
 * Machine translation for Stage-1 pasted / imported Spanish text.
 *
 * Does NOT accept apiConfig and does NOT use resolveClient — this is a
 * traditional MT call (Baidu by default) so it won't burn LLM quota.
 *
 * Required env (see README):
 *   BAIDU_TRANSLATE_APPID
 *   BAIDU_TRANSLATE_KEY
 */

const MAX_CHARS = 8000;
/** Soft shield for free-tier MT quotas — per IP, per minute, per instance. */
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const key = `translate:${clientKeyFromRequest(request)}`;
  const limited = rateLimit(key, { limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "翻译请求过于频繁，请稍后再试", code: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      }
    );
  }

  try {
    const body = await request.json();
    const text = typeof body?.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json(
        { error: "text 不能为空", code: "bad_request" },
        { status: 400 }
      );
    }
    if (text.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `文本过长（最多 ${MAX_CHARS} 字）`, code: "bad_request" },
        { status: 400 }
      );
    }

    const provider = getTranslateProvider();
    const { translation } = await provider.translate({
      text,
      from: "spa",
      to: "zh",
    });

    return NextResponse.json({ translation });
  } catch (error) {
    if (error instanceof TranslateConfigError) {
      console.error("翻译服务未配置:", error.message);
      return NextResponse.json(
        { error: error.message, code: "not_configured" },
        { status: 503 }
      );
    }
    if (error instanceof TranslateRequestError) {
      console.error("翻译请求失败:", error.message);
      return NextResponse.json(
        { error: "翻译请求失败，请稍后重试", code: "request_failed" },
        { status: 502 }
      );
    }
    console.error("翻译失败:", error);
    return NextResponse.json(
      { error: "翻译请求失败，请稍后重试", code: "request_failed" },
      { status: 500 }
    );
  }
}
