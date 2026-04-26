"use client";

import { useState } from "react";

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

type Stage = "input" | "select" | "story" | "quiz";

type Token =
  | { kind: "word"; text: string }
  | { kind: "space"; text: string }
  | { kind: "punct"; text: string };

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

// ─── Spinner ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="w-5 h-5 border-2 border-rim border-t-primary rounded-full animate-spin" />
  );
}

// ─── Shared class strings ────────────────────────────────────────────────────

const btnPrimary =
  "w-full rounded-[10px] bg-primary hover:bg-[#163828] py-4 text-sm font-semibold text-white transition-colors disabled:opacity-25 active:opacity-80";

const sectionLabel =
  "text-[11px] font-semibold text-muted uppercase tracking-widest";

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [stage, setStage] = useState<Stage>("input");

  // Stage 1
  const [inputText, setInputText] = useState("");

  // Stage 2
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [storyLoading, setStoryLoading] = useState(false);

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

  // ── Stage 1 → 2 ────────────────────────────────────────────────────────────

  function handleStartSelect() {
    if (!inputText.trim()) return;
    setTokens(tokenize(inputText));
    setSelectedWords(new Set());
    setStage("select");
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
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          words: Array.from(selectedWords),
          level: "B1",
          genre: "故事",
        }),
      });
      const data: StoryResponse = await res.json();
      setStory(data.story);
      setStage("story");
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
        body: JSON.stringify({ target_word: word, original_sentence: sentence }),
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
        body: JSON.stringify({ story, words: Array.from(selectedWords) }),
      });
      const data: QuizResponse = await res.json();
      setQuiz(data.questions);
      setCurrentQuestion(0);
      setAnswers({});
      setScore(null);
      setStage("quiz");
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
    setStage("input");
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

  // ── Story Renderer ─────────────────────────────────────────────────────────

  function renderStory() {
    return tokenize(story).map((token, i) => {
      if (token.kind === "word" && selectedWords.has(token.text.toLowerCase())) {
        return (
          <span
            key={i}
            onClick={() => handleWordClick(token.text)}
            className="underline underline-offset-[3px] decoration-accent decoration-2 cursor-pointer transition-colors"
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

    return (
      <div className="flex flex-col gap-5">
        {/* Progress bar */}
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

        <p className="text-base font-medium text-ink leading-7">{q.sentence}</p>

        <div className="flex flex-col gap-2.5">
          {q.options.map((option) => {
            let cls =
              "w-full text-left rounded-[8px] border px-4 py-3.5 text-sm font-medium transition-colors ";
            if (!answered) {
              cls +=
                "border-rim text-ink hover:bg-primary-light/30 active:bg-primary-light/50";
            } else if (option === q.answer) {
              cls += "border-green-400 bg-[#E8F5E9] text-green-700";
            } else if (option === answered) {
              cls += "border-red-300 bg-[#FFEBEE] text-red-500";
            } else {
              cls += "border-rim/30 text-muted/40";
            }
            return (
              <button key={option} onClick={() => handleAnswer(option)} className={cls}>
                {option}
              </button>
            );
          })}
        </div>

        {answered && (
          <button onClick={handleNextOrScore} className={btnPrimary}>
            {isLast ? "查看得分" : "下一题"}
          </button>
        )}
      </div>
    );
  }

  // ─── Fixed bottom bar (shared between select & story stages) ─────────────

  function BottomBar({ children }: { children: React.ReactNode }) {
    return (
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg/95 backdrop-blur border-t border-rim px-5 py-4">
        {children}
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-[430px] flex flex-col min-h-screen relative">

        {/* ════════════════════════════════════════════ Stage 1: Input */}
        {stage === "input" && (
          <div className="flex flex-col flex-1 px-5 pt-16 pb-8 gap-6">
            <div>
              <h1 className="font-serif text-[48px] font-bold leading-tight tracking-tight text-primary">
                La Historia
              </h1>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                把你不会的词，变成更容易记住的故事
              </p>
            </div>

            <textarea
              className="flex-1 min-h-52 w-full resize-none rounded-[12px] border border-rim bg-surface px-4 py-3.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
              placeholder="把你正在读的西语文本粘贴进来..."
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
          <>
            <div className="flex flex-col flex-1 px-5 pt-12 pb-32">
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
                            ? "bg-primary-light text-primary font-semibold"
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
              <button
                onClick={handleGenerateStory}
                disabled={selectedWords.size === 0 || storyLoading}
                className={`${btnPrimary} flex items-center justify-center gap-2`}
              >
                {storyLoading ? (
                  <>
                    <Spinner />
                    <span>正在生成故事...</span>
                  </>
                ) : (
                  `用这 ${selectedWords.size} 个词生成故事`
                )}
              </button>
            </BottomBar>
          </>
        )}

        {/* ════════════════════════════════════════════ Stage 3: Story */}
        {stage === "story" && (
          <>
            <div className="flex flex-col flex-1 px-5 pt-12 pb-32">
              <p className={`${sectionLabel} mb-6`}>在新的语境里再认识这些词</p>
              <p className="text-[15px] leading-9 text-ink">{renderStory()}</p>
            </div>

            <BottomBar>
              <button
                onClick={handleGenerateQuiz}
                disabled={quizLoading}
                className={`${btnPrimary} flex items-center justify-center gap-2`}
              >
                {quizLoading ? (
                  <>
                    <Spinner />
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
                {/* Scrim */}
                <div className="absolute inset-0 bg-black/25" />

                {/* Sheet */}
                <div
                  className="relative w-full max-w-[430px] bg-surface rounded-t-2xl px-5 pt-6 pb-12 shadow-[0_-8px_32px_rgba(0,0,0,0.12)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Drag handle */}
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-rim rounded-full" />

                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-serif text-2xl font-bold text-ink">
                        {vocabWord}
                      </span>
                      {vocabCard && (
                        <span className="text-sm text-muted">
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
          </>
        )}

        {/* ════════════════════════════════════════════ Stage 4: Quiz */}
        {stage === "quiz" && (
          <div className="flex flex-col flex-1 px-5 pt-12 pb-8">
            <p className={`${sectionLabel} mb-8`}>巩固一下</p>

            {score !== null ? (
              <div className="flex flex-col items-center gap-4 mt-16">
                <p className={sectionLabel}>得分</p>
                <div className="font-serif text-6xl font-bold tracking-tight text-primary">
                  {score}
                  <span className="text-3xl text-muted">/{quiz.length}</span>
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
      </div>
    </div>
  );
}
