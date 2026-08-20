import { createHash } from "crypto";
import {
  TranslateConfigError,
  TranslateProvider,
  TranslateRequest,
  TranslateRequestError,
  TranslateResult,
} from "./types";

/**
 * Baidu Fanyi Open Platform — general text translation API.
 *
 * Env (set in `.env.local`, never commit real values):
 *   BAIDU_TRANSLATE_APPID  — application ID from https://fanyi-api.baidu.com/
 *   BAIDU_TRANSLATE_KEY    — corresponding secret key
 *
 * Free tier (standard): ~50k characters / month. Docs:
 *   https://fanyi-api.baidu.com/doc/21
 *
 * Signature: MD5(appid + q + salt + key) → 32-char lowercase hex.
 * Single-request payload should stay under ~6000 bytes; we chunk by
 * paragraphs when needed and reassemble with newlines so structure is kept.
 */

const ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
/** Keep a margin under Baidu's ~6000-byte soft limit. */
const MAX_CHUNK_BYTES = 4800;

export class BaiduTranslateProvider implements TranslateProvider {
  readonly name = "baidu";

  async translate(req: TranslateRequest): Promise<TranslateResult> {
    const appid = process.env.BAIDU_TRANSLATE_APPID?.trim();
    const key = process.env.BAIDU_TRANSLATE_KEY?.trim();
    if (!appid || !key) {
      throw new TranslateConfigError(
        "翻译服务未配置：请在 .env.local 中设置 BAIDU_TRANSLATE_APPID 和 BAIDU_TRANSLATE_KEY"
      );
    }

    const chunks = splitForBaidu(req.text);
    const parts: string[] = [];
    for (const chunk of chunks) {
      parts.push(await translateChunk(chunk, req.from, req.to, appid, key));
    }
    return { translation: parts.join("\n").trim() };
  }
}

function splitForBaidu(text: string): string[] {
  const paragraphs = text.split(/\n/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n${paragraph}` : paragraph;
    if (byteLength(candidate) <= MAX_CHUNK_BYTES) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (byteLength(paragraph) <= MAX_CHUNK_BYTES) {
      current = paragraph;
      continue;
    }
    // Oversized single paragraph — hard-split by characters.
    for (const piece of hardSplit(paragraph, MAX_CHUNK_BYTES)) {
      chunks.push(piece);
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

function hardSplit(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    const next = buf + ch;
    if (byteLength(next) > maxBytes) {
      if (buf) out.push(buf);
      buf = ch;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

async function translateChunk(
  q: string,
  from: string,
  to: string,
  appid: string,
  key: string
): Promise<string> {
  if (!q.trim()) return q;

  const salt = String(Date.now()) + String(Math.floor(Math.random() * 10000));
  const sign = createHash("md5")
    .update(appid + q + salt + key)
    .digest("hex");

  const body = new URLSearchParams({
    q,
    from,
    to,
    appid,
    salt,
    sign,
  });

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    throw new TranslateRequestError(
      err instanceof Error ? err.message : "无法连接百度翻译服务"
    );
  }

  const data = (await res.json()) as {
    error_code?: string;
    error_msg?: string;
    trans_result?: { src: string; dst: string }[];
  };

  if (data.error_code) {
    throw new TranslateRequestError(
      `百度翻译错误 ${data.error_code}: ${data.error_msg ?? "unknown"}`
    );
  }

  const rows = data.trans_result;
  if (!rows || rows.length === 0) {
    throw new TranslateRequestError("百度翻译返回为空");
  }

  // Baidu splits on newlines; joining dst with \n preserves paragraph structure.
  return rows.map((r) => r.dst).join("\n");
}
