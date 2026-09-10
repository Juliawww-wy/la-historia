"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import Link from "next/link";
import { btnPrimary, btnGhost, sectionLabel, fieldClass } from "@/app/ui/shared";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface VocabCard {
  word: string;
  part_of_speech: string;
  cefr_level?: string;
  context_meaning: { zh: string; explanation: string };
  general_meaning: { zh: string; en: string; es: string };
  related_expressions?: { es: string; zh: string }[];
  original_sentence: string;
  original_sentence_translation: string;
}

interface QuizQuestion {
  type: "fill_blank";
  sentence: string;
  options: string[];
  answer: string;
}

interface QuizResponse {
  questions: QuizQuestion[];
}

interface StoryResponse {
  story: string;
}

interface ApiConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  label: string;
}

type Stage = "input" | "select" | "story" | "quiz";

type Token =
  | { kind: "word"; text: string }
  | { kind: "space"; text: string }
  | { kind: "punct"; text: string };

type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

interface Article {
  id: string;
  source: string;
  title: string;
  summary: string;
  level: CefrLevel;
  link: string;
  publishedAt: string | null;
}

const FILTERABLE_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

type StoryLevel = "A2" | "B1" | "B2" | "C1";
const STORY_LEVELS: StoryLevel[] = ["A2", "B1", "B2", "C1"];

type StoryScenario = "校园" | "日常生活" | "旅行" | "留学" | "考试阅读";
const STORY_SCENARIOS: StoryScenario[] = ["校园", "日常生活", "旅行", "留学", "考试阅读"];

const PRESETS: { label: string; baseURL: string; model: string; hint: string }[] = [
  { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", hint: "官方性价比之选" },
  { label: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", hint: "质量更稳定" },
  { label: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", hint: "国内可直连" },
];

const SETTINGS_KEY = "la-historia:api-config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /([A-Za-z\u00C0-\u024F\u00AA\u00BA]+(?:'[A-Za-z\u00C0-\u024F]+)*)|([ \t\n\r]+)|([^\s])/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) tokens.push({ kind: "word", text: match[1] });
    else if (match[2]) tokens.push({ kind: "space", text: match[2] });
    else tokens.push({ kind: "punct", text: match[3] });
  }
  return tokens;
}

function findSentenceContaining(story: string, word: string): string {
  const sentences = story.split(/(?<=[.!?¡¿])\s*/);
  const lower = word.toLowerCase();
  return sentences.find((s) => s.toLowerCase().includes(lower)) ?? story;
}

function loadApiConfig(): ApiConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as ApiConfig) : null;
  } catch {
    return null;
  }
}

function buildBookmarklet(origin: string): string {
  // window.open can get silently popup-blocked (common on Safari/iOS) — when
  // that happens it returns null/undefined and the current tab just sits
  // there looking like nothing happened. Fall back to navigating the
  // current tab in that case so the flow always completes.
  const code = `(function(){var s=window.getSelection().toString();if(!s){alert('请先在网页上选中一段西班牙语文本');}else{var u='${origin}/?text='+encodeURIComponent(s);var w=window.open(u,'_blank');if(!w){location.href=u;}}})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

// ─── Small shared pieces ────────────────────────────────────────────────────

function Spinner({ light = false }: { light?: boolean }) {
  return (
    <div
      className={`w-5 h-5 border-2 rounded-full animate-spin ${
        light ? "border-white/30 border-t-white" : "border-rim border-t-primary"
      }`}
    />
  );
}

function TranslationPanel({
  loading,
  translation,
  error,
  open,
  onToggle,
}: {
  loading: boolean;
  translation: string | null;
  error: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  if (!loading && !translation && !error) return null;
  return (
    <div className="pop-enter rounded-[12px] border border-rim bg-primary-light/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className={`${sectionLabel} normal-case tracking-wide`}>中文大意</span>
        <span className="flex items-center gap-2 text-muted">
          {loading && <Spinner />}
          <span className="text-xs">{open ? "收起" : "展开"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3.5 border-t border-rim/60">
          {loading && !translation && (
            <p className="pt-3 text-xs text-muted">正在翻译…</p>
          )}
          {error && !loading && (
            <p className="pt-3 text-xs text-muted">{error}</p>
          )}
          {translation && (
            <p className="pt-3 text-sm text-ink leading-relaxed whitespace-pre-wrap">
              {translation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Article recommendations (Stage 1 secondary entry point) ───────────────

function ArticleLevelFilter({
  levelFilter,
  onFilterChange,
  className = "",
  size = "sm",
}: {
  levelFilter: CefrLevel | "all";
  onFilterChange: (level: CefrLevel | "all") => void;
  className?: string;
  size?: "sm" | "lg";
}) {
  const chipSize =
    size === "lg" ? "px-4 py-1.5 text-sm font-semibold" : "px-3 py-1 text-xs font-medium";
  // "lg" wraps onto multiple rows (desktop board, plenty of width); "sm" stays
  // a single horizontally-scrollable row (mobile carousel). Overflow-x-auto
  // and flex-wrap fight each other — a wrapping flex container with x-auto
  // collapses to zero height in Chrome — so pick one behavior, not both.
  const layout = size === "lg" ? "flex-wrap" : "flex-nowrap overflow-x-auto no-scrollbar";
  return (
    <div className={`flex gap-2 ${layout} ${className}`}>
      <button
        onClick={() => onFilterChange("all")}
        className={`shrink-0 rounded-full border transition-colors ${chipSize} ${
          levelFilter === "all"
            ? "border-primary bg-primary-light text-primary-deep"
            : "border-rim/80 text-muted hover:border-primary/40"
        }`}
      >
        全部
      </button>
      {FILTERABLE_LEVELS.map((lvl) => (
        <button
          key={lvl}
          onClick={() => onFilterChange(lvl)}
          className={`shrink-0 rounded-full border transition-colors ${chipSize} ${
            levelFilter === lvl
              ? "border-primary bg-primary-light text-primary-deep"
              : "border-rim/80 text-muted hover:border-primary/40"
          }`}
        >
          {lvl}
        </button>
      ))}
    </div>
  );
}

function ArticleCard({
  article,
  onPick,
  className = "",
}: {
  article: Article;
  onPick: (article: Article) => void;
  className?: string;
}) {
  return (
    <button
      onClick={() => onPick(article)}
      className={`text-left rounded-[12px] border border-rim bg-surface p-4 hover:border-primary/40 transition-colors ${className}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="rounded-full bg-accent-light/40 text-accent-deep px-2 py-0.5 text-[11px] font-semibold">
          {article.level}
        </span>
        <span className="text-[11px] text-muted truncate">{article.source}</span>
      </div>
      <p className="font-serif text-[15px] font-semibold text-ink leading-snug line-clamp-2 mb-1.5">
        {article.title}
      </p>
      <p className="text-xs text-muted leading-relaxed line-clamp-2">{article.summary}</p>
    </button>
  );
}

function ArticleRecommendations({
  articles,
  levelFilter,
  onFilterChange,
  onPick,
}: {
  articles: Article[];
  levelFilter: CefrLevel | "all";
  onFilterChange: (level: CefrLevel | "all") => void;
  onPick: (article: Article) => void;
}) {
  if (articles.length === 0) return null;

  const filtered =
    levelFilter === "all" ? articles : articles.filter((a) => a.level === levelFilter);

  return (
    <div className="pop-enter">
      <div className="flex items-center justify-between mb-2.5">
        <p className={sectionLabel}>外刊精选 · 分级阅读</p>
      </div>

      <ArticleLevelFilter levelFilter={levelFilter} onFilterChange={onFilterChange} className="mb-3" />

      {filtered.length === 0 ? (
        <p className="text-xs text-muted">这个难度暂时没有推荐文章，换个难度看看。</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
          {filtered.map((article) => (
            <ArticleCard key={article.id} article={article} onPick={onPick} className="shrink-0 w-64" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Desktop-only left column on the input stage — a real article board instead
 * of the mobile horizontal scroller, since there's room for a full list. */
/** Row in the desktop article board — a horizontal slide-in wipe on hover
 * (pure CSS group-hover, no JS mouse tracking / cursor trail). */
function ArticleRow({
  article,
  onPick,
}: {
  article: Article;
  onPick: (article: Article) => void;
}) {
  return (
    <button
      onClick={() => onPick(article)}
      className="group relative flex w-full items-center gap-4 overflow-hidden border-b border-rim/60 py-5 text-left"
    >
      <span
        className="absolute inset-0 -translate-x-full bg-primary-light/50 transition-transform duration-500 ease-out group-hover:translate-x-0"
        aria-hidden="true"
      />
      <span className="relative z-10 min-w-0 flex-1">
        <span className="mb-1 flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-accent-light/40 text-accent-deep px-2 py-0.5 text-[10px] font-semibold">
            {article.level}
          </span>
          <span className="truncate text-[11px] text-muted">{article.source}</span>
        </span>
        <span className="block truncate font-serif text-[15px] font-semibold text-ink leading-snug transition-colors group-hover:text-primary-deep">
          {article.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">{article.summary}</span>
      </span>
      <span className="relative z-10 shrink-0 -translate-x-2 text-muted opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
        →
      </span>
    </button>
  );
}

function ArticleBoardDesktop({
  articles,
  levelFilter,
  onFilterChange,
  onPick,
}: {
  articles: Article[];
  levelFilter: CefrLevel | "all";
  onFilterChange: (level: CefrLevel | "all") => void;
  onPick: (article: Article) => void;
}) {
  const filtered =
    levelFilter === "all" ? articles : articles.filter((a) => a.level === levelFilter);

  return (
    <div className="flex h-full flex-col px-8 pb-10 pt-12 xl:px-12">
      <p className="mb-5 font-serif text-2xl font-bold text-primary-deep">外刊精选 · 分级阅读</p>
      <ArticleLevelFilter
        levelFilter={levelFilter}
        onFilterChange={onFilterChange}
        className="mb-6"
        size="lg"
      />
      {articles.length === 0 ? (
        <p className="mt-6 text-xs text-muted">暂无外刊推荐，请稍后再来看看。</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-xs text-muted">这个难度暂时没有推荐文章，换个难度看看。</p>
      ) : (
        <div className="flex flex-col">
          {filtered.map((article) => (
            <ArticleRow key={article.id} article={article} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Vocab card body (shared by the mobile bottom sheet + desktop side panel) ─

function VocabCardBody({ card }: { card: VocabCard }) {
  return (
    <div className="space-y-4">
      <div>
        <p className={`${sectionLabel} mb-1`}>在本文中的意思</p>
        <p className="text-[15px] text-ink leading-relaxed">{card.context_meaning.zh}</p>
        {card.context_meaning.explanation && (
          <p className="mt-1 text-sm text-muted leading-relaxed">
            {card.context_meaning.explanation}
          </p>
        )}
      </div>
      <div className="border-t border-rim pt-4">
        <p className={`${sectionLabel} mb-1`}>常见含义</p>
        <p className="text-[15px] text-ink leading-relaxed">{card.general_meaning.zh}</p>
        <p className="mt-1 text-sm text-muted">{card.general_meaning.en}</p>
      </div>
      {card.related_expressions && card.related_expressions.length > 0 && (
        <div className="border-t border-rim pt-4">
          <p className={`${sectionLabel} mb-2`}>联想表达</p>
          <div className="space-y-2">
            {card.related_expressions.map((expr, i) => (
              <div key={i}>
                <p className="text-[15px] text-ink leading-relaxed">{expr.es}</p>
                <p className="text-sm text-muted">{expr.zh}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveToVocabButton({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <button
      onClick={onSave}
      disabled={saved}
      className={`mt-5 w-full rounded-[10px] border px-4 py-2.5 text-sm font-medium transition-colors ${
        saved
          ? "border-primary/40 bg-primary-light text-primary-deep cursor-default"
          : "border-rim text-ink hover:border-primary/40 hover:bg-primary-light/30"
      }`}
    >
      {saved ? "已存入生词库 ✓" : "加入生词库"}
    </button>
  );
}

/** Desktop-only persistent panel, replacing the bottom sheet on `lg:` for the
 * select/story stages — sits beside the text instead of covering it. */
function VocabSidePanel({
  word,
  card,
  loading,
  saved,
  onSave,
}: {
  word: string | null;
  card: VocabCard | null;
  loading: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex h-full flex-col px-8 pt-20 pb-10 xl:px-10">
      <div className="mx-auto w-full max-w-[360px]">
        {!word && (
          <p className="mt-10 text-center text-sm text-muted leading-relaxed">
            点击左侧文本中的一个词查看释义；
            <br />
            也可以按住鼠标拖选一段短语，加入自己的语料库。
          </p>
        )}
        {word && (
          <div key={word} className="pop-enter">
            <div className="mb-5 flex flex-wrap items-baseline gap-2">
              <span className="font-serif text-2xl font-bold text-primary-deep">{word}</span>
              {card && (
                <span className="text-sm text-muted px-2 py-0.5 rounded-full bg-primary-light">
                  {card.part_of_speech}
                </span>
              )}
              {card?.cefr_level && (
                <span className="text-xs font-semibold text-accent-deep px-2 py-0.5 rounded-full bg-accent-light/40">
                  {card.cefr_level}
                </span>
              )}
            </div>
            {loading && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}
            {!loading && card && (
              <>
                <VocabCardBody card={card} />
                <SaveToVocabButton saved={saved} onSave={onSave} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Header icon buttons (settings / bookmarklet) ───────────────────────────

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 flex items-center justify-center rounded-full text-primary/70 hover:text-accent hover:bg-accent-light/30 transition-colors"
    >
      {children}
    </button>
  );
}

// ─── Fixed bottom bar (shared between select & story stages) ───────────────

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-gradient-to-t from-bg via-bg/95 to-transparent pt-8 px-5 pb-6 lg:absolute lg:left-0 lg:right-0 lg:translate-x-0 lg:max-w-none">
      {children}
    </div>
  );
}

/** One sketched Spanish-culture word + a loose, unclosed line icon. */
function DoodleWord({
  word,
  icon,
  posClass,
  rotate,
  delay = false,
}: {
  word: string;
  icon: React.ReactNode;
  posClass: string;
  rotate: number;
  delay?: boolean;
}) {
  return (
    <div
      className={`absolute flex items-center gap-2 ${
        delay ? "marginalia-enter-delay" : "marginalia-enter"
      } ${posClass}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {icon}
      <span className="doodle-word text-[26px]">{word}</span>
    </div>
  );
}

const doodleIconProps = {
  width: 28,
  height: 28,
  viewBox: "0 0 28 28",
  fill: "none" as const,
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "doodle-icon shrink-0",
};

/** Desktop-only ambient décor around the journal card — pure presentation. */
function DesktopMarginalia() {
  return (
    <div
      className="pointer-events-none absolute inset-0 hidden lg:block overflow-hidden"
      aria-hidden="true"
    >
      {/* Oversized brand watermark */}
      <p className="absolute top-[8%] left-1/2 -translate-x-1/2 font-serif text-[clamp(5rem,14vw,11rem)] font-bold leading-none tracking-tight text-primary-deep/[0.045] select-none whitespace-nowrap">
        La Historia
      </p>

      {/* Left margin: product blurb + flourish */}
      <aside className="marginalia-enter absolute top-[22%] left-[max(1.5rem,calc(50%-430px/2-20rem))] w-[15.5rem] xl:left-[max(2rem,calc(50%-430px/2-22rem))]">
        <svg
          className="mb-4 w-28"
          width="112"
          height="28"
          viewBox="0 0 112 28"
          fill="none"
        >
          <path
            d="M4 18c8-10 16 8 24-2s14-8 22 2 16 10 24 0 14-10 22 0 12 8 18 2"
            stroke="var(--accent)"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="flourish-path-long"
            opacity="0.75"
          />
          {/* Quill tip */}
          <path
            d="M96 6c4 2 8 6 10 12-4-1-8-3-12-7 1-2 2-3.5 2-5Z"
            fill="var(--primary)"
            opacity="0.35"
          />
        </svg>
        <p className="font-serif text-lg font-bold text-primary-deep/70 leading-snug">
          把生词写进故事里
        </p>
        <p className="mt-2 text-[13px] text-muted/80 leading-relaxed">
          选中不会的西语词，让它们自然出现在一篇新故事中——读、点、练，一气呵成。
        </p>
      </aside>

      {/* Right margin: living demo of vocab → story */}
      <aside className="marginalia-enter-delay absolute top-[28%] right-[max(1.5rem,calc(50%-430px/2-20rem))] w-[15.5rem] xl:right-[max(2rem,calc(50%-430px/2-22rem))]">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted/70 mb-3">
          生词 → 故事
        </p>
        <p className="text-[13px] text-ink/70 leading-7 mb-4">
          <span className="ink-squiggle">conocer</span>
          {" · "}
          <span className="ink-squiggle">mañana</span>
          {" · "}
          <span className="ink-squiggle">calle</span>
        </p>
        <svg
          className="mb-3 w-24"
          width="96"
          height="8"
          viewBox="0 0 96 8"
          fill="none"
        >
          <path
            d="M2 5c10-5 20 5 30 0s20-5 30 0 20 5 30 0"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="flourish-path"
            opacity="0.7"
          />
        </svg>
        <p className="font-serif text-[14px] text-primary-deep/65 leading-7 italic">
          Una{" "}
          <span className="ink-squiggle not-italic">mañana</span>
          , decidió{" "}
          <span className="ink-squiggle not-italic">conocer</span>
          {" "}la{" "}
          <span className="ink-squiggle not-italic">calle</span>
          {" "}donde creció…
        </p>
      </aside>

      {/* Sketched Spanish-culture words, scattered loosely in the margins */}
      <DoodleWord
        word="sangría"
        rotate={-6}
        posClass="top-[5%] left-[max(1.5rem,calc(50%-430px/2-23rem))]"
        icon={
          <svg {...doodleIconProps}>
            <path d="M7 4c0 5 1 9 7 9s7-4 7-9" />
            <path d="M14 13v10" />
            <path d="M9 25l10-1" />
          </svg>
        }
      />
      <DoodleWord
        word="flamenco"
        rotate={5}
        delay
        posClass="top-[9%] right-[max(1.5rem,calc(50%-430px/2-24rem))]"
        icon={
          <svg {...doodleIconProps}>
            <path d="M4 22c0-9 7-13 12-11 6 2 7 8 3 10-3 2-7 0-6-3 1-2 4-2 5 0" />
          </svg>
        }
      />
      <DoodleWord
        word="siesta"
        rotate={-4}
        posClass="top-[63%] left-[max(1.5rem,calc(50%-430px/2-21.5rem))]"
        icon={
          <svg {...doodleIconProps}>
            <path d="M18 5c-7 0-12 5-12 11s5 11 12 11c-9 1-16-4-16-11S9 4 18 5Z" />
          </svg>
        }
      />
      <DoodleWord
        word="tertulia"
        rotate={6}
        delay
        posClass="top-[58%] right-[max(1.5rem,calc(50%-430px/2-21.5rem))]"
        icon={
          <svg {...doodleIconProps}>
            <path d="M4 7c0-1.5 1-2.5 2.5-2.5h15C22.5 4.5 24 6 24 8v8c0 1.5-1.5 2.5-3 2.5h-9L7 23l1-4.5H6.5C5 18.5 4 17.5 4 16Z" />
          </svg>
        }
      />

      {/* Bottom corner flourish */}
      <svg
        className="absolute bottom-10 left-[max(2rem,calc(50%-430px/2-18rem))] w-40 opacity-50"
        width="160"
        height="36"
        viewBox="0 0 160 36"
        fill="none"
      >
        <path
          d="M4 28c18-16 36 12 54-4s34-14 50 4 30 14 48-2"
          stroke="var(--primary)"
          strokeWidth="1.4"
          strokeLinecap="round"
          className="flourish-path-long"
        />
      </svg>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HomeClient({ initialArticles }: { initialArticles: Article[] }) {
  const [stage, setStage] = useState<Stage>("input");
  const [stageKey, setStageKey] = useState(0);

  // Stage 1
  const [inputText, setInputText] = useState("");
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationOpen, setTranslationOpen] = useState(true);
  const translateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateAbortRef = useRef<AbortController | null>(null);
  const lastTranslatedRef = useRef("");

  // Stage 2
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [storyLevel, setStoryLevel] = useState<StoryLevel>("B1");
  const [storyScenario, setStoryScenario] = useState<StoryScenario>("日常生活");
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);

  // Stage 3
  const [story, setStory] = useState("");
  const [vocabWord, setVocabWord] = useState<string | null>(null);
  const [vocabCard, setVocabCard] = useState<VocabCard | null>(null);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);

  // Word/phrase lookup cache + explicit save state (lookup and "save to vocab
  // book" used to be bundled into one click — now separate, see
  // handleWordClick / handleSaveCurrentToVocab / handleBulkSaveToVocab).
  const vocabCardCacheRef = useRef<Record<string, VocabCard>>({});
  const [panelSaved, setPanelSaved] = useState(false);
  const [bulkSaveStatus, setBulkSaveStatus] = useState<"idle" | "saving" | "done">("idle");

  // Stage 4
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [score, setScore] = useState<number | null>(null);

  // Settings / bookmarklet
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [origin, setOrigin] = useState("");

  // Article recommendations (Stage 1 secondary entry point) — hydrated
  // server-side (see app/page.tsx) so they're present on first paint,
  // no client fetch/flash of empty state.
  const [articles] = useState<Article[]>(initialArticles);
  const [levelFilter, setLevelFilter] = useState<CefrLevel | "all">("all");
  const [articleSource, setArticleSource] = useState<{ name: string; link: string } | null>(
    null
  );

  // Vocab book (logged-in only; UI-signal only, real auth checks live server-side)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  function clearTranslation() {
    if (translateTimerRef.current) {
      clearTimeout(translateTimerRef.current);
      translateTimerRef.current = null;
    }
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    lastTranslatedRef.current = "";
    setTranslation(null);
    setTranslationLoading(false);
    setTranslationError(null);
  }

  async function requestTranslate(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      clearTranslation();
      return;
    }
    if (trimmed === lastTranslatedRef.current) return;

    if (translateTimerRef.current) {
      clearTimeout(translateTimerRef.current);
      translateTimerRef.current = null;
    }
    translateAbortRef.current?.abort();
    const ac = new AbortController();
    translateAbortRef.current = ac;

    setTranslation(null);
    setTranslationError(null);
    setTranslationLoading(true);
    setTranslationOpen(true);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
        signal: ac.signal,
      });
      const data = (await res.json()) as {
        translation?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (data.code === "not_configured") {
          setTranslationError("翻译服务未配置");
        } else if (data.code === "rate_limited") {
          setTranslationError("翻译过于频繁，请稍后再试");
        } else {
          setTranslationError("翻译请求失败");
        }
        return;
      }
      lastTranslatedRef.current = trimmed;
      setTranslation(data.translation?.trim() || null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setTranslationError("翻译请求失败");
    } finally {
      if (translateAbortRef.current === ac) {
        setTranslationLoading(false);
      }
    }
  }

  function scheduleTranslate(text: string) {
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    translateTimerRef.current = setTimeout(() => {
      translateTimerRef.current = null;
      void requestTranslate(text);
    }, 1500);
  }

  function handleInputChange(value: string) {
    setInputText(value);
    if (!value.trim()) {
      clearTranslation();
      return;
    }
    scheduleTranslate(value);
  }

  function handleInputPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? inputText.length;
    const end = el.selectionEnd ?? start;
    const next = inputText.slice(0, start) + pasted + inputText.slice(end);
    e.preventDefault();
    setInputText(next);
    void requestTranslate(next);
  }

  // ── Boot: load saved API config, load ?text= from bookmarklet ─────────────

  function importIncomingText(incoming: string) {
    if (!incoming.trim()) return;
    setInputText(incoming);
    setTokens(tokenize(incoming));
    setSelectedWords(new Set());
    setStage("select");
    setStageKey((k) => k + 1);
    void requestTranslate(incoming);
  }

  useEffect(() => {
    // One-time hydration from localStorage / URL on mount — safe by
    // construction (empty dep array, runs once), just noisy under the
    // stricter set-state-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiConfig(loadApiConfig());
    setOrigin(window.location.origin);

    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("text");
    if (incoming && incoming.trim()) {
      window.history.replaceState({}, "", window.location.pathname);
      importIncomingText(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only boot
  }, []);

  // ── 划词导入扩展：通过 CustomEvent 从 content script 接收选中文本 ─────────
  useEffect(() => {
    function handleExtensionImport(e: Event) {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text && text.trim()) importIncomingText(text);
    }
    window.addEventListener("la-historia:import", handleExtensionImport);
    return () => window.removeEventListener("la-historia:import", handleExtensionImport);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable listener, mount-only
  }, []);

  useEffect(() => {
    return () => {
      if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
      translateAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data: { email: string | null }) => {
        if (!cancelled) setCurrentUserEmail(data.email);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function goToStage(next: Stage) {
    setStage(next);
    setStageKey((k) => k + 1);
  }

  // ── Stage 1 → 2 ────────────────────────────────────────────────────────────

  function handleStartSelect() {
    if (!inputText.trim()) return;
    setTokens(tokenize(inputText));
    setSelectedWords(new Set());
    goToStage("select");
  }

  function handlePickArticle(article: Article) {
    setInputText(article.summary);
    setTokens(tokenize(article.summary));
    setSelectedWords(new Set());
    setArticleSource({ name: article.source, link: article.link });
    goToStage("select");
    void requestTranslate(article.summary);
  }

  // ── Stage 2 ────────────────────────────────────────────────────────────────

  function toggleWord(word: string) {
    const key = word.toLowerCase();
    setSelectedWords((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setBulkSaveStatus("idle");
  }

  function handleTextMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    sel.removeAllRanges();
    // Only treat a drag as a "phrase" when it spans more than one token —
    // a plain click-to-toggle on a single word is handled separately, and
    // we don't want the two gestures to fight over the same click.
    if (!text || !/\s/.test(text)) return;
    void handleWordClick(text, inputText);
  }

  async function handleGenerateStory() {
    if (selectedWords.size === 0 || storyLoading) return;
    setStoryLoading(true);
    setStoryError(null);
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          words: Array.from(selectedWords),
          level: storyLevel,
          genre: "故事",
          scenario: storyScenario,
          apiConfig,
        }),
      });
      if (!res.ok) throw new Error();
      const data: StoryResponse = await res.json();
      setStory(data.story);
      goToStage("story");
    } catch {
      setStoryError("故事生成失败，请检查网络或 API 设置后重试");
    } finally {
      setStoryLoading(false);
    }
  }

  // ── Word/phrase lookup (select stage + story stage share this) ──────────────
  // Lookup only fills the panel/sheet — it no longer writes to the vocab book
  // by itself. Saving is now an explicit action (handleSaveCurrentToVocab /
  // handleBulkSaveToVocab) so "look something up" and "keep it" are distinct.

  async function fetchVocabCard(word: string, sourceText: string): Promise<VocabCard> {
    const key = word.toLowerCase();
    const cached = vocabCardCacheRef.current[key];
    if (cached) return cached;
    const sentence = findSentenceContaining(sourceText, word);
    const res = await fetch("/api/vocab-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_word: word, original_sentence: sentence, apiConfig }),
    });
    const data: VocabCard = await res.json();
    vocabCardCacheRef.current[key] = data;
    return data;
  }

  async function handleWordClick(word: string, sourceText: string) {
    if (vocabLoading) return;
    setVocabWord(word);
    setVocabCard(null);
    setPanelSaved(false);
    setVocabLoading(true);
    try {
      const data = await fetchVocabCard(word, sourceText);
      setVocabCard(data);
    } finally {
      setVocabLoading(false);
    }
  }

  function closeVocabCard() {
    setVocabWord(null);
    setVocabCard(null);
  }

  async function saveVocabEntry(word: string, card: VocabCard) {
    await fetch("/api/vocab-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: card.word || word,
        part_of_speech: card.part_of_speech,
        cefr_level: card.cefr_level,
        context_meaning_zh: card.context_meaning.zh,
        context_explanation: card.context_meaning.explanation,
        general_meaning_zh: card.general_meaning.zh,
        general_meaning_en: card.general_meaning.en,
        related_expressions: card.related_expressions,
        original_sentence: card.original_sentence,
        original_sentence_translation: card.original_sentence_translation,
      }),
    });
  }

  async function handleSaveCurrentToVocab() {
    if (!vocabWord || !vocabCard || panelSaved) return;
    if (!currentUserEmail) {
      setLoginPromptOpen(true);
      return;
    }
    try {
      await saveVocabEntry(vocabWord, vocabCard);
      setPanelSaved(true);
    } catch {
      // best-effort, same fire-and-forget tolerance as the rest of the vocab flow
    }
  }

  async function handleBulkSaveToVocab() {
    if (selectedWords.size === 0 || bulkSaveStatus === "saving") return;
    if (!currentUserEmail) {
      setLoginPromptOpen(true);
      return;
    }
    setBulkSaveStatus("saving");
    try {
      for (const w of selectedWords) {
        const card = await fetchVocabCard(w, inputText);
        await saveVocabEntry(w, card);
      }
      setBulkSaveStatus("done");
    } catch {
      setBulkSaveStatus("idle");
    }
  }

  async function handleGenerateQuiz() {
    if (quizLoading) return;
    setQuizLoading(true);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, words: Array.from(selectedWords), apiConfig }),
      });
      const data: QuizResponse = await res.json();
      setQuiz(data.questions);
      setCurrentQuestion(0);
      setAnswers({});
      setScore(null);
      goToStage("quiz");
    } finally {
      setQuizLoading(false);
    }
  }

  // ── Stage 4 ────────────────────────────────────────────────────────────────

  function handleAnswer(option: string) {
    if (answers[currentQuestion] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion]: option }));
  }

  function handleNextOrScore() {
    if (currentQuestion < quiz.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      const correct = quiz.filter((q, i) => answers[i] === q.answer).length;
      setScore(correct);
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  function handleReset() {
    goToStage("input");
    setInputText("");
    clearTranslation();
    setTokens([]);
    setSelectedWords(new Set());
    setArticleSource(null);
    setStory("");
    setVocabWord(null);
    setVocabCard(null);
    setQuiz([]);
    setAnswers({});
    setScore(null);
    setCurrentQuestion(0);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  function saveSettings(cfg: ApiConfig | null) {
    setApiConfig(cfg);
    if (cfg) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
    else window.localStorage.removeItem(SETTINGS_KEY);
    setSettingsOpen(false);
  }

  // ── Story Renderer ─────────────────────────────────────────────────────────

  function renderStory() {
    return tokenize(story).map((token, i) => {
      if (token.kind !== "word") return <span key={i}>{token.text}</span>;
      const isTargetWord = selectedWords.has(token.text.toLowerCase());
      return (
        <span
          key={i}
          onClick={() => handleWordClick(token.text, story)}
          className={`cursor-pointer rounded px-0.5 transition-colors ${
            isTargetWord
              ? "ink-squiggle hover:opacity-70"
              : "hover:bg-primary-light/50"
          }`}
        >
          {token.text}
        </span>
      );
    });
  }

  // ── Quiz Current Question ──────────────────────────────────────────────────

  function renderQuestion() {
    const q = quiz[currentQuestion];
    const answered = answers[currentQuestion];
    const isLast = currentQuestion === quiz.length - 1;
    const letters = ["A", "B", "C", "D"];

    return (
      <div className="flex flex-col gap-5">
        <div className="flex gap-1.5 mb-1">
          {quiz.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < currentQuestion
                  ? "bg-primary"
                  : i === currentQuestion
                  ? "bg-primary/40"
                  : "bg-rim"
              }`}
            />
          ))}
        </div>

        <p className={`text-xs ${sectionLabel}`}>
          第 {currentQuestion + 1} 题，共 {quiz.length} 题
        </p>

        <p className="font-serif text-lg font-medium text-ink leading-8">{q.sentence}</p>

        <div className="flex flex-col gap-2.5">
          {q.options.map((option, oi) => {
            let cls =
              "w-full flex items-center gap-3 text-left rounded-[10px] border px-4 py-3.5 text-sm font-medium transition-colors ";
            let badgeCls =
              "w-6 h-6 shrink-0 flex items-center justify-center rounded-full text-[11px] font-bold border ";
            if (!answered) {
              cls += "border-rim text-ink hover:border-primary/40 hover:bg-primary-light/30";
              badgeCls += "border-rim text-muted";
            } else if (option === q.answer) {
              cls += "border-primary/50 bg-primary-light text-primary-deep";
              badgeCls += "border-primary bg-primary text-white";
            } else if (option === answered) {
              cls += "border-[#D98572] bg-[#FBEBE7] text-[#B0503A]";
              badgeCls += "border-[#D98572] bg-[#D98572] text-white";
            } else {
              cls += "border-rim/30 text-muted/40";
              badgeCls += "border-rim/30 text-muted/30";
            }
            return (
              <button key={option} onClick={() => handleAnswer(option)} className={cls}>
                <span className={badgeCls}>{letters[oi]}</span>
                {option}
              </button>
            );
          })}
        </div>

        {answered && (
          <button onClick={handleNextOrScore} className={`${btnPrimary} pop-enter`}>
            {isLast ? "查看得分" : "下一题"}
          </button>
        )}
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className={`paper-grain min-h-screen bg-bg flex justify-center relative overflow-x-hidden ${
        stage === "input" || stage === "select" || stage === "story"
          ? "lg:h-screen lg:overflow-hidden"
          : ""
      }`}
    >
      {stage === "input" ? (
        <div className="hidden lg:flex lg:w-1/2 lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-r lg:border-rim/60">
          <ArticleBoardDesktop
            articles={articles}
            levelFilter={levelFilter}
            onFilterChange={setLevelFilter}
            onPick={handlePickArticle}
          />
        </div>
      ) : stage === "quiz" ? (
        <DesktopMarginalia />
      ) : null}

      <div
        className={`flex justify-center items-start w-full ${
          stage === "input"
            ? "lg:w-1/2 lg:h-screen lg:overflow-y-auto lg:px-6"
            : stage === "select" || stage === "story"
            ? "lg:w-2/3 lg:h-screen lg:overflow-y-auto lg:px-6"
            : ""
        }`}
      >
      <div
        className={`journal-page relative z-10 w-full max-w-[430px] flex flex-col min-h-screen lg:my-8 lg:min-h-[calc(100vh-4rem)] lg:rounded-sm ${
          stage === "input"
            ? "lg:max-w-[480px]"
            : stage === "select" || stage === "story"
            ? "lg:max-w-[640px]"
            : ""
        }`}
      >

        {/* Header: settings + bookmarklet, present on every stage */}
        <div className="absolute top-4 right-4 z-20 flex gap-1">
          <IconButton label="划词导入工具" onClick={() => setBookmarkletOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </IconButton>
          <IconButton label="API 设置" onClick={() => setSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15 1.65 1.65 0 0 0 3.17 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </IconButton>
          <Link
            href={currentUserEmail ? "/vocab" : "/login"}
            aria-label="生词本"
            className="w-9 h-9 flex items-center justify-center rounded-full text-primary/70 hover:text-accent hover:bg-accent-light/30 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        {/* ════════════════════════════════════════════ Stage 1: Input */}
        {stage === "input" && (
          <div key={stageKey} className="stage-enter flex flex-col flex-1 px-5 pt-20 pb-8 gap-7 lg:px-10">
            <div>
              <h1 className="font-serif text-[52px] font-bold leading-[0.95] tracking-tight text-primary-deep">
                La Historia
              </h1>
              <svg
                className="mt-2 w-[178px]"
                width="178" height="10" viewBox="0 0 178 10" fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 6c14-6 28 6 42 0s28-6 42 0 28 6 42 0 28-6 42 0 28-6 42 0"
                  stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"
                  className="flourish-path"
                />
              </svg>
              <p className="mt-3 text-[15px] text-muted leading-relaxed">
                把你不会的词，变成更容易记住的故事
              </p>
            </div>

            <div className="lg:hidden">
              <ArticleRecommendations
                articles={articles}
                levelFilter={levelFilter}
                onFilterChange={setLevelFilter}
                onPick={handlePickArticle}
              />
            </div>

            <textarea
              className="flex-1 min-h-52 w-full resize-none rounded-[14px] border border-rim bg-surface px-4 py-3.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors shadow-[0_2px_10px_rgba(15,46,34,0.05)]"
              placeholder="把你正在读的西语文本粘贴进来，或点击右上角 ⚡ 直接从网页划词导入..."
              value={inputText}
              onChange={(e) => handleInputChange(e.target.value)}
              onPaste={handleInputPaste}
            />

            {(translationLoading || translation || translationError) && (
              <div className="-mt-3">
                <TranslationPanel
                  loading={translationLoading}
                  translation={translation}
                  error={translationError}
                  open={translationOpen}
                  onToggle={() => setTranslationOpen((o) => !o)}
                />
              </div>
            )}

            <button
              onClick={handleStartSelect}
              disabled={!inputText.trim()}
              className={btnPrimary}
            >
              开始选词
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════ Stage 2: Select */}
        {stage === "select" && (
          <div key={stageKey} className="stage-enter contents">
            <div className="flex flex-col flex-1 px-5 pt-20 pb-32">
              <div className="flex items-center justify-between mb-4">
                <p className={sectionLabel}>点击你不认识的词</p>
                <button
                  onClick={() => goToStage("input")}
                  className="text-xs text-muted hover:text-primary transition-colors"
                >
                  ← 返回首页
                </button>
              </div>
              {articleSource && (
                <p className="-mt-2.5 mb-4 text-xs text-muted">
                  素材来自 {articleSource.name} ·{" "}
                  <a
                    href={articleSource.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    阅读原文 ↗
                  </a>
                </p>
              )}
              {(translationLoading || translation || translationError) && (
                <div className="mb-5">
                  <TranslationPanel
                    loading={translationLoading}
                    translation={translation}
                    error={translationError}
                    open={translationOpen}
                    onToggle={() => setTranslationOpen((o) => !o)}
                  />
                </div>
              )}
              <div className="text-[15px] leading-9 text-ink" onMouseUp={handleTextMouseUp}>
                {tokens.map((token, i) => {
                  if (token.kind === "word") {
                    const selected = selectedWords.has(token.text.toLowerCase());
                    return (
                      <span
                        key={i}
                        onClick={() => {
                          toggleWord(token.text);
                          void handleWordClick(token.text, inputText);
                        }}
                        className={`cursor-pointer rounded px-0.5 transition-colors ${
                          selected
                            ? "bg-primary-light text-primary-deep font-semibold"
                            : "hover:bg-primary-light/50"
                        }`}
                      >
                        {token.text}
                      </span>
                    );
                  }
                  return <span key={i}>{token.text}</span>;
                })}
              </div>
            </div>

            <BottomBar>
              {storyError && (
                <p className="mb-2.5 text-xs text-[#B0503A] text-center">{storyError}</p>
              )}
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs text-muted">故事难度</span>
                <div className="flex gap-1.5">
                  {STORY_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setStoryLevel(lvl)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        storyLevel === lvl
                          ? "border-primary bg-primary-light text-primary-deep"
                          : "border-rim text-muted"
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted">故事场景</span>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                  {STORY_SCENARIOS.map((sc) => (
                    <button
                      key={sc}
                      onClick={() => setStoryScenario(sc)}
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        storyScenario === sc
                          ? "border-primary bg-primary-light text-primary-deep"
                          : "border-rim text-muted"
                      }`}
                    >
                      {sc}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2.5">
                <button
                  onClick={handleGenerateStory}
                  disabled={selectedWords.size === 0 || storyLoading}
                  className={`${btnPrimary} flex-1 flex items-center justify-center gap-2`}
                >
                  {storyLoading ? (
                    <>
                      <Spinner light />
                      <span>正在生成故事...</span>
                    </>
                  ) : (
                    `生成故事（${selectedWords.size}）`
                  )}
                </button>
                <button
                  onClick={handleBulkSaveToVocab}
                  disabled={selectedWords.size === 0 || bulkSaveStatus === "saving"}
                  className={`${btnGhost} flex-1 flex items-center justify-center gap-2 disabled:opacity-40`}
                >
                  {bulkSaveStatus === "saving" ? (
                    <>
                      <Spinner />
                      <span>存入中...</span>
                    </>
                  ) : bulkSaveStatus === "done" ? (
                    "已存入生词库 ✓"
                  ) : (
                    "直接加入生词库"
                  )}
                </button>
              </div>
            </BottomBar>
          </div>
        )}

        {/* ════════════════════════════════════════════ Stage 3: Story */}
        {stage === "story" && (
          <div key={stageKey} className="stage-enter contents">
            <div className="flex flex-col flex-1 px-5 pt-20 pb-32">
              <p className={`${sectionLabel} mb-6`}>在新的语境里再认识这些词</p>
              <p className="font-serif text-[17px] leading-10 text-ink">{renderStory()}</p>
            </div>

            <BottomBar>
              <button
                onClick={handleGenerateQuiz}
                disabled={quizLoading}
                className={`${btnPrimary} flex items-center justify-center gap-2`}
              >
                {quizLoading ? (
                  <>
                    <Spinner light />
                    <span>正在生成练习...</span>
                  </>
                ) : (
                  "开始练习"
                )}
              </button>
            </BottomBar>
          </div>
        )}

        {/* ════════════════════════════════════════════ Stage 4: Quiz */}
        {stage === "quiz" && (
          <div key={stageKey} className="stage-enter flex flex-col flex-1 px-5 pt-20 pb-8">
            <p className={`${sectionLabel} mb-8`}>巩固一下</p>

            {score !== null ? (
              <div className="pop-enter flex flex-col items-center gap-4 mt-16">
                <p className={sectionLabel}>得分</p>
                <div className="relative w-32 h-32 flex items-center justify-center">
                  <svg className="absolute inset-0" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="46" fill="none" stroke="var(--border)" strokeWidth="2" />
                    <circle
                      cx="50" cy="50" r="46" fill="none" stroke="var(--accent)" strokeWidth="2.5"
                      strokeDasharray={2 * Math.PI * 46}
                      strokeDashoffset={2 * Math.PI * 46 * (1 - score / Math.max(quiz.length, 1))}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <div className="font-serif text-5xl font-bold tracking-tight text-primary-deep">
                    {score}
                    <span className="text-2xl text-muted">/{quiz.length}</span>
                  </div>
                </div>
                <p className="text-sm text-muted mt-1">
                  {score === quiz.length
                    ? "全部答对，词汇掌握得不错"
                    : score >= Math.ceil(quiz.length / 2)
                    ? "做得不错，继续加油"
                    : "还需要多练习，加油"}
                </p>
                <button onClick={handleReset} className={`mt-8 ${btnPrimary}`}>
                  再学一段
                </button>
              </div>
            ) : (
              quiz.length > 0 && renderQuestion()
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ Vocab Card Bottom Sheet */}
        {/* Mobile only — lg: uses the persistent VocabSidePanel instead so the
            text never gets covered. Shared by the select stage (any word) and
            the story stage (any word). */}
        {vocabWord && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center lg:hidden"
            onClick={closeVocabCard}
          >
            <div className="absolute inset-0 bg-primary-deep/20 backdrop-blur-[1px]" />

            <div
              className="sheet-enter relative w-full max-w-[430px] bg-surface rounded-t-2xl px-5 pt-6 pb-12 shadow-[0_-8px_32px_rgba(15,46,34,0.16)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-rim rounded-full" />

              <div className="flex items-start justify-between mb-5">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-2xl font-bold text-primary-deep">
                    {vocabWord}
                  </span>
                  {vocabCard && (
                    <span className="text-sm text-muted px-2 py-0.5 rounded-full bg-primary-light">
                      {vocabCard.part_of_speech}
                    </span>
                  )}
                  {vocabCard?.cefr_level && (
                    <span className="text-xs font-semibold text-accent-deep px-2 py-0.5 rounded-full bg-accent-light/40">
                      {vocabCard.cefr_level}
                    </span>
                  )}
                </div>
                <button
                  onClick={closeVocabCard}
                  className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center rounded-full hover:bg-primary-light transition-colors text-base"
                >
                  ✕
                </button>
              </div>

              {vocabLoading && (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              )}

              {!vocabLoading && vocabCard && (
                <>
                  <VocabCardBody card={vocabCard} />
                  <SaveToVocabButton saved={panelSaved} onSave={handleSaveCurrentToVocab} />
                </>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════ Settings Sheet */}
        {settingsOpen && (
          <SettingsSheet
            current={apiConfig}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
          />
        )}

        {/* ════════════════════════════════════════════ Bookmarklet Sheet */}
        {bookmarkletOpen && origin && (
          <BookmarkletSheet origin={origin} onClose={() => setBookmarkletOpen(false)} />
        )}

        {/* ════════════════════════════════════════════ Login Prompt Sheet */}
        {loginPromptOpen && (
          <LoginPromptSheet onClose={() => setLoginPromptOpen(false)} />
        )}
      </div>
      </div>

      {(stage === "select" || stage === "story") && (
        <div className="hidden lg:flex lg:w-1/3 lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-l lg:border-rim/60">
          <VocabSidePanel
            word={vocabWord}
            card={vocabCard}
            loading={vocabLoading}
            saved={panelSaved}
            onSave={handleSaveCurrentToVocab}
          />
        </div>
      )}
    </div>
  );
}

// ─── Login Prompt Sheet ──────────────────────────────────────────────────────

function LoginPromptSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-primary-deep/20 backdrop-blur-[1px]" />
      <div
        className="sheet-enter relative w-full max-w-[430px] bg-surface rounded-t-2xl px-5 pt-6 pb-10 shadow-[0_-8px_32px_rgba(15,46,34,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-rim rounded-full" />

        <div className="flex items-start justify-between mb-1">
          <h2 className="font-serif text-xl font-bold text-primary-deep">先登录再收藏</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center rounded-full hover:bg-primary-light transition-colors"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-muted leading-relaxed mb-5">
          生词库是跟账号绑定的，登录后选的词才会被保存下来。选词、生成故事这些不受影响，随时都能用。
        </p>

        <div className="flex gap-2.5">
          <button onClick={onClose} className={`${btnGhost} flex-1`}>
            再看看
          </button>
          <Link href="/login" className={`${btnPrimary} flex-1 text-center`}>
            去登录
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Sheet ──────────────────────────────────────────────────────────

function SettingsSheet({
  current,
  onClose,
  onSave,
}: {
  current: ApiConfig | null;
  onClose: () => void;
  onSave: (cfg: ApiConfig | null) => void;
}) {
  const [custom, setCustom] = useState(!!current);
  const [baseURL, setBaseURL] = useState(current?.baseURL ?? PRESETS[0].baseURL);
  const [model, setModel] = useState(current?.model ?? PRESETS[0].model);
  const [apiKey, setApiKey] = useState(current?.apiKey ?? "");
  const [label, setLabel] = useState(current?.label ?? PRESETS[0].label);

  function applyPreset(p: (typeof PRESETS)[number]) {
    setLabel(p.label);
    setBaseURL(p.baseURL);
    setModel(p.model);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-primary-deep/20 backdrop-blur-[1px]" />
      <div
        className="sheet-enter relative w-full max-w-[430px] max-h-[86vh] overflow-y-auto bg-surface rounded-t-2xl px-5 pt-6 pb-10 shadow-[0_-8px_32px_rgba(15,46,34,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-rim rounded-full" />

        <div className="flex items-start justify-between mb-1">
          <h2 className="font-serif text-xl font-bold text-primary-deep">API 设置</h2>
          <button onClick={onClose} className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center rounded-full hover:bg-primary-light transition-colors">✕</button>
        </div>
        <p className="text-xs text-muted leading-relaxed mb-5">
          默认使用平台提供的免费额度。如果想获得更高质量的生成，或者不想排队，可以填入自己的 API Key —— 它只会被转发用于当次请求，不会保存在服务器上，仅存在你的浏览器本地。
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setCustom(false)}
            className={`flex-1 rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors ${
              !custom ? "border-primary bg-primary-light text-primary-deep" : "border-rim text-muted"
            }`}
          >
            使用默认（DeepSeek）
          </button>
          <button
            onClick={() => setCustom(true)}
            className={`flex-1 rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors ${
              custom ? "border-primary bg-primary-light text-primary-deep" : "border-rim text-muted"
            }`}
          >
            自定义 API
          </button>
        </div>

        {custom && (
          <div className="flex flex-col gap-4">
            <div>
              <p className={`${sectionLabel} mb-2`}>选择平台</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className={`${btnGhost} ${label === p.label ? "border-primary bg-primary-light text-primary-deep" : ""}`}
                  >
                    {p.label}
                    <span className="ml-1 text-[11px] text-muted">{p.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Base URL</span>
              <input className={fieldClass} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.example.com/v1" />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>模型名称</span>
              <input className={fieldClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="例如 deepseek-chat" />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>API Key</span>
              <input className={fieldClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </label>
          </div>
        )}

        <button
          onClick={() =>
            onSave(custom ? { baseURL, model, apiKey, label } : null)
          }
          disabled={custom && (!baseURL || !model || !apiKey)}
          className={`${btnPrimary} mt-6`}
        >
          保存设置
        </button>
      </div>
    </div>
  );
}

// ─── Bookmarklet / Extension Sheet ─────────────────────────────────────────

type BookmarkBrowser = "chrome" | "safari" | "edge";

function detectBookmarkBrowser(): BookmarkBrowser {
  if (typeof navigator === "undefined") return "chrome";
  const ua = navigator.userAgent;
  if (/Edg\/|EdgiOS\//.test(ua)) return "edge";
  if (/Chrome\/|CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "safari";
  return "chrome";
}

const BOOKMARK_GUIDES: Record<
  BookmarkBrowser,
  { label: string; steps: string[]; note?: string }
> = {
  chrome: {
    label: "Chrome",
    steps: [
      "打开书签栏（没有的话按 ⌘⇧B / Ctrl+Shift+B 显示）",
      "在书签栏空白处右键 → 选择「添加网页」或「添加书签」",
      "名称随意填（例如「La Historia」），网址栏粘贴刚才复制的链接，保存即可",
    ],
  },
  edge: {
    label: "Edge",
    steps: [
      "打开收藏夹栏（没有的话按 ⌘⇧B / Ctrl+Shift+B 显示）",
      "在收藏夹栏空白处右键 → 选择「添加页面」或「新建收藏」",
      "名称随意填（例如「La Historia」），网址栏粘贴刚才复制的链接，保存即可",
    ],
  },
  safari: {
    label: "Safari",
    steps: [
      "菜单栏「书签」→「添加书签」，保存位置选「收藏栏」",
      "保存后再打开「书签」→「编辑书签」，找到刚加的那条",
      "把网址替换成刚才复制的链接，保存即可",
    ],
    note: "Safari 有时会拦截 javascript: 前缀。如果粘贴后发现网址开头没有 javascript:，请手动在开头补上。",
  },
};

type ExtensionBrowser = "chrome" | "edge";

const EXTENSION_DOWNLOAD_URL = "/la-historia-extension.zip";

const EXTENSION_GUIDES: Record<ExtensionBrowser, { label: string; steps: string[] }> = {
  chrome: {
    label: "Chrome",
    steps: [
      "下载插件压缩包并解压",
      "地址栏打开 chrome://extensions",
      "右上角开启「开发者模式」",
      "点击「加载已解压的扩展程序」，选中解压出来的 la-historia-extension 文件夹",
      "以后在任意网页选中西语文本，右键点「用 La Historia 查词」即可自动跳回这里",
    ],
  },
  edge: {
    label: "Edge",
    steps: [
      "下载插件压缩包并解压",
      "地址栏打开 edge://extensions",
      "左下角开启「开发人员模式」",
      "点击「加载解压缩的扩展」，选中解压出来的 la-historia-extension 文件夹",
      "以后在任意网页选中西语文本，右键点「用 La Historia 查词」即可自动跳回这里",
    ],
  },
};

function BookmarkletSheet({ origin, onClose }: { origin: string; onClose: () => void }) {
  const href = buildBookmarklet(origin);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [browser, setBrowser] = useState<BookmarkBrowser>(detectBookmarkBrowser);
  const guide = BOOKMARK_GUIDES[browser];

  const [method, setMethod] = useState<"extension" | "bookmark">(
    browser === "safari" ? "bookmark" : "extension"
  );
  const [extBrowser, setExtBrowser] = useState<ExtensionBrowser>(
    browser === "edge" ? "edge" : "chrome"
  );
  const extGuide = EXTENSION_GUIDES[extBrowser];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-primary-deep/20 backdrop-blur-[1px]" />
      <div
        className="sheet-enter relative w-full max-w-[430px] max-h-[86vh] overflow-y-auto bg-surface rounded-t-2xl px-5 pt-6 pb-10 shadow-[0_-8px_32px_rgba(15,46,34,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-rim rounded-full" />

        <div className="flex items-start justify-between mb-1">
          <h2 className="font-serif text-xl font-bold text-primary-deep">划词导入</h2>
          <button onClick={onClose} className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center rounded-full hover:bg-primary-light transition-colors">✕</button>
        </div>
        <p className="text-xs text-muted leading-relaxed mb-4">
          在任意网页选中一段西语文本，就能直接跳回这里开始选词。有两种接入方式：浏览器插件更稳定（不受长文本截断影响），书签则是免安装的备用方案。
        </p>

        <div className="flex gap-2 mb-5" role="tablist" aria-label="选择导入方式">
          <button
            role="tab"
            aria-selected={method === "extension"}
            onClick={() => setMethod("extension")}
            className={`flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors ${
              method === "extension"
                ? "border-primary bg-primary-light text-primary-deep"
                : "border-rim text-muted"
            }`}
          >
            插件（推荐）
          </button>
          <button
            role="tab"
            aria-selected={method === "bookmark"}
            onClick={() => setMethod("bookmark")}
            className={`flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors ${
              method === "bookmark"
                ? "border-primary bg-primary-light text-primary-deep"
                : "border-rim text-muted"
            }`}
          >
            书签（备用）
          </button>
        </div>

        {method === "extension" ? (
          <>
            <p className="text-xs text-muted leading-relaxed mb-4">
              仅支持 Chrome / Edge 桌面版（暂未上架商店，需要手动加载一次）。文本通过浏览器插件直接传递，不走网址参数，长文本、隐私插件清理参数等都不会影响它。
            </p>

            <div className="flex gap-2 mb-4" role="tablist" aria-label="选择浏览器">
              {(Object.keys(EXTENSION_GUIDES) as ExtensionBrowser[]).map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={extBrowser === id}
                  onClick={() => setExtBrowser(id)}
                  className={`flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors ${
                    extBrowser === id
                      ? "border-primary bg-primary-light text-primary-deep"
                      : "border-rim text-muted"
                  }`}
                >
                  {EXTENSION_GUIDES[id].label}
                </button>
              ))}
            </div>

            <ol className="flex flex-col gap-2.5">
              {extGuide.steps.map((step, i) => (
                <li key={step} className="flex gap-2.5 text-sm text-ink leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-light text-[11px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="flex flex-1 flex-wrap items-center gap-2">
                    <span>{step}</span>
                    {i === 0 && (
                      <a
                        href={EXTENSION_DOWNLOAD_URL}
                        download
                        className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-deep"
                      >
                        下载 .zip
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 rounded-[8px] border border-accent/30 bg-accent-light/20 px-3 py-2 text-[11px] leading-relaxed text-ink">
              下载解压后直接选那个文件夹即可，不用问开发者要代码。iOS / Safari 暂不支持这种方式，请用「书签」方案。
            </p>
          </>
        ) : (
          <>
            <p className={`${sectionLabel} mb-2`}>1. 复制书签链接</p>
            <button onClick={copyLink} className={btnPrimary}>
              {copied ? "已复制 ✓" : "复制链接"}
            </button>
            {copied && (
              <p className="pop-enter mt-2 text-center text-xs font-medium text-primary">
                已复制，现在去按下面步骤新建书签
              </p>
            )}
            {copyFailed && (
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-[11px] text-muted">复制失败，请手动全选下面的链接</span>
                <input
                  className={fieldClass}
                  readOnly
                  value={href}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
            )}

            <p className={`${sectionLabel} mt-6 mb-2`}>2. 按你的浏览器新建书签</p>
            <div className="flex gap-2 mb-4" role="tablist" aria-label="选择浏览器">
              {(Object.keys(BOOKMARK_GUIDES) as BookmarkBrowser[]).map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={browser === id}
                  onClick={() => setBrowser(id)}
                  className={`flex-1 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors ${
                    browser === id
                      ? "border-primary bg-primary-light text-primary-deep"
                      : "border-rim text-muted"
                  }`}
                >
                  {BOOKMARK_GUIDES[id].label}
                </button>
              ))}
            </div>

            <ol className="flex flex-col gap-2.5">
              {guide.steps.map((step, i) => (
                <li key={step} className="flex gap-2.5 text-sm text-ink leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-light text-[11px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {guide.note && (
              <p className="mt-3 rounded-[8px] border border-accent/30 bg-accent-light/20 px-3 py-2 text-[11px] leading-relaxed text-ink">
                {guide.note}
              </p>
            )}

            <details className="mt-6 rounded-[12px] border border-dashed border-rim bg-primary-light/30 px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium text-muted select-none">
                也可以拖到书签栏（需先显示书签栏）
              </summary>
              <div className="flex flex-col items-center gap-3 pt-4 pb-2">
                <a
                  href={href}
                  onClick={(e) => e.preventDefault()}
                  draggable
                  className="select-none cursor-grab active:cursor-grabbing rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(15,46,34,0.18)]"
                >
                  ⚡ 用 La Historia 学这段
                </a>
                <p className="text-[11px] text-muted">↑ 把它拖到书签栏</p>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
