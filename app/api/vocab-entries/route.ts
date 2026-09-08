import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/dal";
import { sql } from "@/app/lib/db";

/**
 * Called fire-and-forget from the vocab-card flow in app/page.tsx right
 * after a card successfully loads. Silently no-ops when signed out — being
 * logged out must never interrupt the core select/story/quiz flow.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ skipped: true }, { status: 200 });

  const body = await request.json();
  const word = typeof body?.word === "string" ? body.word.trim() : "";
  if (!word) {
    return NextResponse.json({ error: "word 不能为空" }, { status: 400 });
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const expressions = Array.isArray(body.related_expressions)
    ? body.related_expressions.filter(
        (e: unknown): e is { es: string; zh: string } =>
          !!e &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).es === "string" &&
          typeof (e as Record<string, unknown>).zh === "string"
      )
    : [];
  const relatedExpressionsJson = expressions.length > 0 ? JSON.stringify(expressions) : null;

  try {
    await sql`
      INSERT INTO vocab_entries (
        user_id, word, part_of_speech, cefr_level,
        context_meaning_zh, context_explanation,
        general_meaning_zh, general_meaning_en, related_expressions,
        original_sentence, original_sentence_translation
      ) VALUES (
        ${session.userId}, ${word}, ${str(body.part_of_speech)}, ${str(body.cefr_level)},
        ${str(body.context_meaning_zh)}, ${str(body.context_explanation)},
        ${str(body.general_meaning_zh)}, ${str(body.general_meaning_en)}, ${relatedExpressionsJson},
        ${str(body.original_sentence)}, ${str(body.original_sentence_translation)}
      )
      ON CONFLICT (user_id, word) DO UPDATE SET
        times_seen = vocab_entries.times_seen + 1,
        last_seen_at = now(),
        part_of_speech = EXCLUDED.part_of_speech,
        cefr_level = EXCLUDED.cefr_level,
        context_meaning_zh = EXCLUDED.context_meaning_zh,
        context_explanation = EXCLUDED.context_explanation,
        general_meaning_zh = EXCLUDED.general_meaning_zh,
        general_meaning_en = EXCLUDED.general_meaning_en,
        related_expressions = EXCLUDED.related_expressions,
        original_sentence = EXCLUDED.original_sentence,
        original_sentence_translation = EXCLUDED.original_sentence_translation
    `;
  } catch (err) {
    console.error("生词记录失败:", err);
    return NextResponse.json({ error: "记录失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
