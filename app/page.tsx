"use client";

import { useEffect, useState } from "react";

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
  "w-full rounded-[10px] bg-primary hover:bg-primary-deep py-4 text-sm font-semibold text-white transition-colors disabled:opacity-25 active:opacity-80 shadow-[0_4px_14px_rgba(15,46,34,0.18)]";

const btnGhost =
  "rounded-[10px] border border-rim bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-primary/40 hover:bg-primary-light/40 transition-colors";

const sectionLabel =
  "text-[11px] font-semibold text-muted uppercase tracking-widest";

const fieldClass =
  "w-full rounded-[8px] border border-rim bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-primary/50 transition-colors";

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
      className="w-9 h-9 flex items-center justify-center rounded-full text-primary/70 hover:text-primary hover:bg-primary-light/60 transition-colors"
    >
      {children}
    </button>
  );
}

// ─── Fixed bottom bar (shared between select & story stages) ───────────────

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-gradient-to-t from-bg via-bg/95 to-transparent pt-8 px-5 pb-6">
      {children}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [stage, setStage] = useState<Stage>("input");
  const [stageKey, setStageKey] = useState(0);

  // Stage 1
  const [inputText, setInputText] = useState("");

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
    }
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
    <div className="paper-grain min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-[430px] flex flex-col min-h-screen relative">

        {/* Header: settings + bookmarklet, present on every stage */}
        <div className="absolute top-4 right-4 z-20 flex gap-1">
          <IconButton label="划词导入工具" onClick={() => setBookmarkletOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </IconButton>
          <IconButton label="API 设置" onClick={() => setSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
              onChange={(e) => setInputText(e.target.value)}
            />

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
              <p className={`${sectionLabel} mb-6`}>点击你不认识的词</p>
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

function BookmarkletSheet({ origin, onClose }: { origin: string; onClose: () => void }) {
  const href = buildBookmarklet(origin);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — user can still drag the link manually
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-primary-deep/20 backdrop-blur-[1px]" />
      <div
        className="sheet-enter relative w-full max-w-[430px] bg-surface rounded-t-2xl px-5 pt-6 pb-10 shadow-[0_-8px_32px_rgba(15,46,34,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-rim rounded-full" />

        <div className="flex items-start justify-between mb-1">
          <h2 className="font-serif text-xl font-bold text-primary-deep">划词导入</h2>
          <button onClick={onClose} className="text-muted hover:text-ink w-7 h-7 flex items-center justify-center rounded-full hover:bg-primary-light transition-colors">✕</button>
        </div>
        <p className="text-xs text-muted leading-relaxed mb-5">
          把下面的按钮拖到浏览器书签栏。以后在任意网页上选中一段西语文本，点一下书签，就会直接跳回这里开始选词——不用再手动复制粘贴。
        </p>

        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-rim bg-primary-light/30 px-4 py-6">
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

        <button onClick={copyLink} className={`${btnGhost} w-full mt-4`}>
          {copied ? "已复制 ✓" : "手机 / 触屏设备：复制链接手动添加"}
        </button>
      </div>
    </div>
  );
}
