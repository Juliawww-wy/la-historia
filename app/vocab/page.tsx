import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/app/lib/dal";
import { sql } from "@/app/lib/db";
import { logout } from "@/app/actions/auth";
import { sectionLabel } from "@/app/ui/shared";

interface VocabRow {
  id: string;
  word: string;
  part_of_speech: string | null;
  cefr_level: string | null;
  context_meaning_zh: string | null;
  context_explanation: string | null;
  general_meaning_zh: string | null;
  general_meaning_en: string | null;
  related_expressions: { es: string; zh: string }[] | null;
  original_sentence: string | null;
  original_sentence_translation: string | null;
  times_seen: number;
  last_seen_at: string;
}

export default async function VocabPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const entries = (await sql`
    SELECT id, word, part_of_speech, cefr_level, context_meaning_zh, context_explanation,
           general_meaning_zh, general_meaning_en, related_expressions, original_sentence,
           original_sentence_translation, times_seen, last_seen_at
    FROM vocab_entries
    WHERE user_id = ${session.userId}
    ORDER BY last_seen_at DESC
  `) as VocabRow[];

  return (
    <div className="paper-grain min-h-screen bg-bg flex justify-center relative overflow-x-hidden">
      <div className="relative z-10 w-full max-w-[430px] flex flex-col min-h-screen px-5 pt-20 pb-12">
        <div className="flex items-start justify-between mb-1">
          <div>
            <Link href="/" className="text-sm text-muted hover:text-ink mb-4 inline-block">
              ← 返回
            </Link>
            <h1 className="font-serif text-3xl font-bold text-primary-deep">生词本</h1>
            <p className="text-[13px] text-muted mt-1">{session.email}</p>
          </div>
          <form action={logout}>
            <button type="submit" className="text-xs text-muted hover:text-ink underline">
              退出登录
            </button>
          </form>
        </div>

        {entries.length === 0 ? (
          <p className="mt-16 text-center text-sm text-muted">
            还没有记录。去选一段文本，点开词卡看看的词会自动出现在这里。
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {entries.map((e) => (
              <div
                key={e.id}
                className="rounded-[12px] border border-rim bg-surface p-4"
              >
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-xl font-bold text-primary-deep">
                      {e.word}
                    </span>
                    {e.part_of_speech && (
                      <span className="text-xs text-muted px-2 py-0.5 rounded-full bg-primary-light">
                        {e.part_of_speech}
                      </span>
                    )}
                    {e.cefr_level && (
                      <span className="text-[11px] font-semibold text-accent-deep px-2 py-0.5 rounded-full bg-accent-light/40">
                        {e.cefr_level}
                      </span>
                    )}
                  </div>
                  {e.times_seen > 1 && (
                    <span className="text-[11px] text-muted shrink-0">看过 {e.times_seen} 次</span>
                  )}
                </div>

                {e.context_meaning_zh && (
                  <div className="mb-2">
                    <p className={`${sectionLabel} mb-0.5`}>在语境中</p>
                    <p className="text-sm text-ink leading-relaxed">{e.context_meaning_zh}</p>
                  </div>
                )}

                {e.general_meaning_zh && (
                  <div className="mb-2">
                    <p className={`${sectionLabel} mb-0.5`}>常见含义</p>
                    <p className="text-sm text-ink leading-relaxed">
                      {e.general_meaning_zh}
                      {e.general_meaning_en && (
                        <span className="text-muted"> · {e.general_meaning_en}</span>
                      )}
                    </p>
                  </div>
                )}

                {e.related_expressions && e.related_expressions.length > 0 && (
                  <div className="mb-2">
                    <p className={`${sectionLabel} mb-0.5`}>联想表达</p>
                    <div className="space-y-1">
                      {e.related_expressions.map((expr, i) => (
                        <p key={i} className="text-sm text-ink leading-relaxed">
                          {expr.es}
                          <span className="text-muted"> · {expr.zh}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {e.original_sentence && (
                  <div className="border-t border-rim mt-3 pt-3">
                    <p className="text-sm text-ink italic leading-relaxed">
                      {e.original_sentence}
                    </p>
                    {e.original_sentence_translation && (
                      <p className="text-xs text-muted mt-1 leading-relaxed">
                        {e.original_sentence_translation}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
