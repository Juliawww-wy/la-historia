import { setDefaultResultOrder } from "node:dns";
import { resolveClient } from "./ai-client";

// Some hosts (BBC's among them) resolve an IPv6 address that's unreachable
// in certain network setups — Node's fetch tries it first and stalls until
// timeout instead of falling back to IPv4 quickly. Prefer IPv4 up front.
setDefaultResultOrder("ipv4first");

/**
 * Homepage "外刊精选" recommendations — real Spanish-language news RSS,
 * summary-only (title + description, no full-text scraping) with a CEFR
 * level tag from a batched LLM classification call.
 *
 * Single file, no provider abstraction: unlike translate/, there's no
 * BYOK / multi-vendor case here, just a fixed list of feeds.
 */

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface Article {
  id: string;
  source: string;
  title: string;
  summary: string;
  level: CefrLevel;
  link: string;
  publishedAt: string | null;
}

const FEED_SOURCES: { name: string; url: string }[] = [
  { name: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml" },
  { name: "El Mundo", url: "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml" },
];

/** Cap items per feed so a single refresh never triggers a huge classify batch. */
const ITEMS_PER_FEED = 8;
/** How long a fetched+classified list stays fresh before we re-pull the feeds. */
const LIST_TTL_MS = 3 * 60 * 60 * 1000;

const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DEFAULT_LEVEL: CefrLevel = "B1";

interface RawItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  link: string;
  publishedAt: string | null;
}

interface SimplifiedItem {
  level: CefrLevel;
  title: string;
  summary: string;
}

const BEGINNER_LEVELS: CefrLevel[] = ["A1", "A2"];

/** Classification result per article guid — persists across list refreshes
 *  so a re-appearing article never gets re-classified. */
const levelCache = new Map<string, CefrLevel>();
/** AI-simplified (A1/A2) rewrite per article guid — same persistence idea. */
const simplifiedCache = new Map<string, SimplifiedItem>();
let listCache: { articles: Article[]; fetchedAt: number } | null = null;

export async function getRecommendedArticles(): Promise<Article[]> {
  if (listCache && Date.now() - listCache.fetchedAt < LIST_TTL_MS) {
    return listCache.articles;
  }

  const rawItems = await fetchAllFeeds();
  if (rawItems.length === 0) {
    return listCache?.articles ?? [];
  }

  const toClassify = rawItems.filter((it) => !levelCache.has(it.id));
  if (toClassify.length > 0) {
    try {
      const levels = await classifyLevels(toClassify);
      for (const [id, level] of levels) levelCache.set(id, level);
    } catch (err) {
      console.error("外刊 CEFR 分级失败，降级为默认难度:", err);
      for (const it of toClassify) levelCache.set(it.id, DEFAULT_LEVEL);
    }
  }

  // Real news headlines skew B1+ no matter the source — generate an A1/A2
  // paraphrase of each so beginners have something too. This is a fresh
  // AI rewrite (not a copy of the original wording), still linking back
  // to the real article for attribution.
  const toSimplify = rawItems.filter((it) => !simplifiedCache.has(it.id));
  if (toSimplify.length > 0) {
    try {
      const simplified = await simplifyForLearners(toSimplify);
      for (const [id, item] of simplified) simplifiedCache.set(id, item);
    } catch (err) {
      console.error("外刊 AI 简写失败，跳过本轮简化版:", err);
    }
  }

  const articles: Article[] = rawItems.map((it) => ({
    ...it,
    level: levelCache.get(it.id) ?? DEFAULT_LEVEL,
  }));

  const simplifiedArticles: Article[] = rawItems.flatMap((it) => {
    const s = simplifiedCache.get(it.id);
    if (!s) return [];
    return [
      {
        id: `${it.id}::simplified`,
        source: `${it.source} · AI 简写`,
        title: s.title,
        summary: s.summary,
        level: s.level,
        link: it.link,
        publishedAt: it.publishedAt,
      },
    ];
  });

  listCache = { articles: [...articles, ...simplifiedArticles], fetchedAt: Date.now() };
  return listCache.articles;
}

// ─── RSS fetch + parse ───────────────────────────────────────────────────────

async function fetchAllFeeds(): Promise<RawItem[]> {
  const results = await Promise.allSettled(FEED_SOURCES.map(fetchFeed));
  const items: RawItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else console.error("外刊 RSS 源抓取失败:", r.reason);
  }
  return items;
}

async function fetchFeed(feed: { name: string; url: string }): Promise<RawItem[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LaHistoriaBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${feed.name} 返回 ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml, feed.name).slice(0, ITEMS_PER_FEED);
}

function parseRssItems(xml: string, source: string): RawItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
  const items: RawItem[] = [];

  for (const block of blocks) {
    const title = cleanText(extractTag(block, "title"));
    // Some feeds (e.g. El Mundo) embed a "Leer" ("read more") link inside
    // <description> — after tag-stripping it survives as a trailing word.
    const summary = cleanText(extractTag(block, "description")).replace(/\s*Leer$/, "");
    const link = cleanText(extractTag(block, "link"));
    const guid = cleanText(extractTag(block, "guid")) || link;
    const pubDateRaw = extractTag(block, "pubDate");

    if (!title || !summary || !link) continue;

    let publishedAt: string | null = null;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    items.push({ id: guid, source, title, summary, link, publishedAt });
  }

  return items;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  const cdata = m[1].trim().match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : m[1];
}

function cleanText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

// ─── CEFR classification ─────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are a CEFR reading-difficulty classifier for Spanish texts, used by a Spanish-learning app for Chinese speakers.

Given a JSON array of articles (each with an "id", a "title", and a "summary" in Spanish), classify the reading difficulty of EACH one as exactly one CEFR level: A1, A2, B1, B2, C1, or C2.

Return ONLY a JSON array in this exact format, with no explanation, no markdown, and no code blocks:
[{ "id": "...", "level": "B1" }]

Every input id must appear exactly once in the output.`;

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

async function classifyLevels(
  items: RawItem[]
): Promise<Map<string, CefrLevel>> {
  const { client, model } = resolveClient(undefined);

  const userMessage = JSON.stringify(
    items.map((it) => ({ id: it.id, title: it.title, summary: it.summary }))
  );

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  const parsed = JSON.parse(extractJson(raw)) as { id: string; level: string }[];

  const result = new Map<string, CefrLevel>();
  for (const row of parsed) {
    if (typeof row.id === "string" && CEFR_LEVELS.includes(row.level as CefrLevel)) {
      result.set(row.id, row.level as CefrLevel);
    }
  }
  return result;
}

// ─── AI simplification for beginners ─────────────────────────────────────────

const SIMPLIFY_PROMPT = `You are a Spanish-for-beginners writing assistant, used by a Spanish-learning app for Chinese speakers.

Given a JSON array of real news items (each with an "id", a "title", and a "summary" in Spanish), rewrite EACH one as a short, genuinely simple version for A1/A2 learners:
- Write in your OWN words — do not copy phrases directly from the input. This is a fresh paraphrase, not an excerpt.
- 2-3 short sentences, present tense where possible, everyday high-frequency vocabulary, no subjunctive or complex subordination.
- Keep the core fact/topic recognizable, drop nuance and detail that requires advanced vocabulary.
- Also write a short simple title (a plain factual phrase, not headline-style wordplay).
- Report which of the two levels it ended up at: "A1" or "A2".

Return ONLY a JSON array in this exact format, with no explanation, no markdown, and no code blocks:
[{ "id": "...", "level": "A2", "title": "...", "summary": "..." }]

Every input id must appear exactly once in the output.`;

async function simplifyForLearners(
  items: RawItem[]
): Promise<Map<string, SimplifiedItem>> {
  const { client, model } = resolveClient(undefined);

  const userMessage = JSON.stringify(
    items.map((it) => ({ id: it.id, title: it.title, summary: it.summary }))
  );

  const response = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [
      { role: "system", content: SIMPLIFY_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  const parsed = JSON.parse(extractJson(raw)) as {
    id: string;
    level: string;
    title: string;
    summary: string;
  }[];

  const result = new Map<string, SimplifiedItem>();
  for (const row of parsed) {
    if (
      typeof row.id === "string" &&
      BEGINNER_LEVELS.includes(row.level as CefrLevel) &&
      typeof row.title === "string" &&
      row.title.trim() &&
      typeof row.summary === "string" &&
      row.summary.trim()
    ) {
      result.set(row.id, {
        level: row.level as CefrLevel,
        title: row.title.trim(),
        summary: row.summary.trim(),
      });
    }
  }
  return result;
}
