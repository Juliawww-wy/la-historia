"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface VocabCard {
  word: string;
  part_of_speech: string;
  context_meaning: { zh: string; explanation: string };
  general_meaning: { zh: string; en: string; es: string };
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
  const code = `(function(){var s=window.getSelection().toString();if(!s){alert('请先在网页上选中一段西班牙语文本');}else{window.open('${origin}/?text='+encodeURIComponent(s),'_blank');}})();`;
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

const btnPrimary =
  "w-full rounded-[8px] bg-accent hover:bg-accent-deep py-4 text-sm font-semibold text-white transition-[background-color,box-shadow,transform] duration-150 disabled:opacity-25 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 shadow-[5px_6px_0_0_#000] hover:shadow-[3px_4px_0_0_#000] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-[1px_2px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px]";

const btnGhost =
  "rounded-[10px] border border-rim bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-primary/40 hover:bg-primary-light/40 transition-colors";

const sectionLabel =
  "text-[11px] font-semibold text-muted uppercase tracking-widest";

const fieldClass =
  "w-full rounded-[8px] border border-rim bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-primary/50 transition-colors";

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

export default function Home() {
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
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);

  // Stage 3
  const [story, setStory] = useState("");
  const [vocabWord, setVocabWord] = useState<string | null>(null);
  const [vocabCard, setVocabCard] = useState<VocabCard | null>(null);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);

  // Stage 4
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [score, setScore] = useState<number | null>(null);

  // Settings / bookmarklet
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);
  const [origin, setOrigin] = useState("");

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
      setInputText(incoming);
      setTokens(tokenize(incoming));
      setSelectedWords(new Set());
      setStage("select");
      setStageKey((k) => k + 1);
      window.history.replaceState({}, "", window.location.pathname);
      void requestTranslate(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only boot
  }, []);

  useEffect(() => {
    return () => {
      if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
      translateAbortRef.current?.abort();
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

  // ── Stage 2 ────────────────────────────────────────────────────────────────

  function toggleWord(word: string) {
    const key = word.toLowerCase();
    setSelectedWords((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
          level: "B1",
          genre: "故事",
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

  // ── Stage 3 ────────────────────────────────────────────────────────────────

  async function handleWordClick(word: string) {
    if (vocabLoading) return;
    setVocabWord(word);
    setVocabCard(null);
    setVocabLoading(true);
    const sentence = findSentenceContaining(story, word);
    try {
      const res = await fetch("/api/vocab-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_word: word, original_sentence: sentence, apiConfig }),
      });
      const data: VocabCard = await res.json();
      setVocabCard(data);
    } finally {
      setVocabLoading(false);
    }
  }

  function closeVocabCard() {
    setVocabWord(null);
    setVocabCard(null);
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
      if (token.kind === "word" && selectedWords.has(token.text.toLowerCase())) {
        return (
          <span
            key={i}
            onClick={() => handleWordClick(token.text)}
            className="ink-squiggle cursor-pointer transition-opacity hover:opacity-70"
          >
            {token.text}
          </span>
        );
      }
      return <span key={i}>{token.text}</span>;
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
    <div className="paper-grain min-h-screen bg-bg flex justify-center relative overflow-x-hidden">
      <DesktopMarginalia />

      <div className="journal-page relative z-10 w-full max-w-[430px] flex flex-col min-h-screen lg:my-8 lg:min-h-[calc(100vh-4rem)] lg:rounded-sm">

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
        </div>

        {/* ════════════════════════════════════════════ Stage 1: Input */}
        {stage === "input" && (
          <div key={stageKey} className="stage-enter flex flex-col flex-1 px-5 pt-20 pb-8 gap-7">
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
              <p className={`${sectionLabel} mb-4`}>点击你不认识的词</p>
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
              <div className="text-[15px] leading-9 text-ink">
                {tokens.map((token, i) => {
                  if (token.kind === "word") {
                    const selected = selectedWords.has(token.text.toLowerCase());
                    return (
                      <span
                        key={i}
                        onClick={() => toggleWord(token.text)}
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
              <button
                onClick={handleGenerateStory}
                disabled={selectedWords.size === 0 || storyLoading}
                className={`${btnPrimary} flex items-center justify-center gap-2`}
              >
                {storyLoading ? (
                  <>
                    <Spinner light />
                    <span>正在生成故事...</span>
                  </>
                ) : (
                  `用这 ${selectedWords.size} 个词生成故事`
                )}
              </button>
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

            {/* Vocab Card Bottom Sheet */}
            {vocabWord && (
              <div
                className="fixed inset-0 z-50 flex items-end justify-center"
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
                    <div className="space-y-4">
                      <div>
                        <p className={`${sectionLabel} mb-1`}>在本文中的意思</p>
                        <p className="text-[15px] text-ink leading-relaxed">
                          {vocabCard.context_meaning.zh}
                        </p>
                        {vocabCard.context_meaning.explanation && (
                          <p className="mt-1 text-sm text-muted leading-relaxed">
                            {vocabCard.context_meaning.explanation}
                          </p>
                        )}
                      </div>
                      <div className="border-t border-rim pt-4">
                        <p className={`${sectionLabel} mb-1`}>常见含义</p>
                        <p className="text-[15px] text-ink leading-relaxed">
                          {vocabCard.general_meaning.zh}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {vocabCard.general_meaning.en}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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

// ─── Bookmarklet Sheet ───────────────────────────────────────────────────────

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

function BookmarkletSheet({ origin, onClose }: { origin: string; onClose: () => void }) {
  const href = buildBookmarklet(origin);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [browser, setBrowser] = useState<BookmarkBrowser>(detectBookmarkBrowser);
  const guide = BOOKMARK_GUIDES[browser];

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
        <p className="text-xs text-muted leading-relaxed mb-5">
          先复制书签链接，再按你的浏览器手动新建一条书签。以后在任意网页上选中一段西语文本，点一下书签，就会直接跳回这里开始选词。
        </p>

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
      </div>
    </div>
  );
}
