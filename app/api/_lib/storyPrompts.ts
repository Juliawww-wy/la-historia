/**
 * La Historia — 故事生成 Prompt（按 CEFR 分级：A2 / B1 / B2 / C1）
 *
 * 使用方式（示意，接入 /api/story 时按实际 resolveClient() 结构调整）：
 *
 *   import { buildStorySystemPrompt } from "./storyPrompts";
 *
 *   const systemPrompt = buildStorySystemPrompt({
 *     level: "B1",
 *     words: ["madrugar", "imprescindible", "por si acaso"],
 *     genre: "故事",      // 故事 | 对话 | 说明文
 *     scenario: "旅行",   // 校园 | 日常生活 | 旅行 | 留学 | 考试阅读
 *   });
 *
 * 设计原则：
 * 1. 每个等级独立写死语法范围、词汇范围、句长范围 —— 不是同一段话加个变量替换难度词，
 *    否则模型对"难度"的理解会很模糊，四档区分度不够。
 * 2. 篇幅统一硬性上限 150 词（西语单词数，不是字符数），且给出比上限更低的目标区间，
 *    因为模型对字数指令普遍会超算，留出缓冲空间比卡死 150 更稳。
 * 3. 每条 prompt 末尾都重复一次字数红线 + 自查指令，经验上"结尾再提醒一次"比只在开头说
 *    更有效，能明显降低超字数概率。
 * 4. 目标词必须自然出现且只能出现一次典型语境（不做同义堆叠、不做词表感），这是文档里
 *    "不能像词表堆砌"这条验收标准的直接体现。
 */

export type StoryLevel = "A2" | "B1" | "B2" | "C1";
export type StoryGenre = "故事" | "对话" | "说明文";
export type StoryScenario = "校园" | "日常生活" | "旅行" | "留学" | "考试阅读";

interface StoryPromptParams {
  level: StoryLevel;
  words: string[];
  genre: StoryGenre;
  scenario: StoryScenario;
}

// ---------------------------------------------------------------------------
// 各等级的语言规格（语法范围 / 词汇范围 / 句长 / 字数区间）
// 依据：Instituto Cervantes《Plan Curricular》CEFR 分级描述 + DELE 各级别阅读文本特征
// ---------------------------------------------------------------------------

const LEVEL_SPEC: Record<
  StoryLevel,
  { targetWords: string; grammar: string; vocab: string; sentence: string; tone: string }
> = {
  A2: {
    targetWords: "80–110 词（硬上限 150 词）",
    grammar:
      "只使用：现在时陈述式、过去简单式（pretérito perfecto / pretérito indefinido 任选其一，不要两种混用造成理解负担）、ir a + 动词原形表将来。" +
      "禁止使用：虚拟式（subjunctive）、被动语态、复杂从句（que 引导的宾语从句可以少量出现，但不用让步/条件类从句）。" +
      "连接词只用：y、pero、porque、cuando、también、después。",
    vocab:
      "只用高频、具体、可视觉化的词汇（人物、地点、时间、日常动作、基本情绪形容词）。" +
      "不使用抽象名词、习语、双关或需要文化背景才能理解的表达。目标词本身可以稍微超出高频范围，" +
      "但目标词周围的句子必须用最简单的词把它'兜住'，让读者靠上下文就能猜出词义。",
    sentence: "每句不超过 10–12 个词，一句只表达一个意思，避免嵌套从句。",
    tone: "语气像讲给刚入门的学习者听的小故事：直白、具体、有画面感，不绕弯子。",
  },
  B1: {
    targetWords: "100–130 词（硬上限 150 词）",
    grammar:
      "可以使用：pretérito indefinido / imperfecto 的对比（叙述过去事件 + 描写背景），简单将来时，" +
      "简单条件式（si + 现在时 / 条件式表一般假设），少量固定搭配中的虚拟式现在时（如 espero que、es importante que，" +
      "每篇最多出现 1 处，不强求）。可以用一层从句（que / cuando / porque 引导），但不要多层嵌套。",
    vocab:
      "在日常高频词基础上，允许部分描述观点、感受、简单因果关系的词汇。可以出现 1–2 个常见习语或固定搭配，" +
      "但必须给出足够语境让读者能推断含义，不能生硬堆砌。",
    sentence: "每句 12–18 个词左右，允许出现一个从句，但避免一句话里塞两个以上从句。",
    tone: "语气自然、有一点细节和转折，像面向已经能读懂简单新闻标题和短文的学习者。",
  },
  B2: {
    targetWords: "120–150 词（硬上限 150 词，尽量贴近上限但不超过）",
    grammar:
      "可以自由使用：各种过去时态对比、将来完成/过去将来表推测、条件式表委婉建议、" +
      "虚拟式现在时和过去未完成时（用于表达怀疑、情感、假设、让步：aunque + subjuntivo、" +
      "aunque + indicativo 的语义差异也可以体现），被动语态（ser + participio 或 se pasiva）可以适量出现。" +
      "允许两层从句嵌套，但要保证逻辑链清晰、不产生歧义。",
    vocab:
      "可以使用抽象名词、观点性词汇、部分书面语/正式语域词汇，以及贴近母语者会自然使用的搭配和习语。" +
      "允许目标词之外出现少量同义替换，增加文本的自然度和词汇密度，但不能牺牲可读性。",
    sentence: "句长和结构可以有明显变化：短句制造节奏，长句承载信息，体现真实文本的韵律感。",
    tone: "语气更贴近真实西语原生文本（新闻特写、生活随笔的语气），允许一定的态度和评价色彩。",
  },
  C1: {
    targetWords: "130–150 词（硬上限 150 词——因信息密度高，务必在生成后自查词数，宁可略短也不能超）",
    grammar:
      "可以自由、准确地使用全部时态和语式，包括虚拟式过去完成时、各类让步/让步假设句" +
      "（por más que、aun cuando + subjuntivo）、强调结构、名词化表达（la búsqueda de、el hecho de que）、" +
      "以及书面语中常见的复杂关联词（no obstante、sin embargo、por consiguiente、a pesar de que、" +
      "de ahí que + subjuntivo）。从句嵌套不设硬性限制，但每一层都必须服务于表达精度，不能为难而难。",
    vocab:
      "可使用低频词、书面语域词汇、隐喻和修辞性表达，词汇选择应体现细微的语义差别（近义词之间的" +
      "褒贬、正式度差异）。目标词应当承担文本中一定的语义或修辞功能，而不只是被'安放'进句子里。",
    sentence:
      "句式富于变化，允许长复合句承载多重信息，同时穿插短句制造节奏对比，整体应读起来接近母语者" +
      "写作的自然文本，而非教材例句的堆砌。",
    tone: "语气可以有立场、有观察角度、有修辞意识，像一篇精炼的西语原生短文，而不是“简化过的 C1”。",
  },
};

// ---------------------------------------------------------------------------
// 生成完整 system prompt
// ---------------------------------------------------------------------------

export function buildStorySystemPrompt({ level, words, genre, scenario }: StoryPromptParams): string {
  const spec = LEVEL_SPEC[level];
  const wordList = words.map((w) => `《${w}》`).join("、");

  return `你是一名精通 CEFR 分级写作标准的西班牙语教学内容设计师，正在为一名中文母语的西班牙语学习者生成一篇 ${level} 级别的西语学习故事。

【读者水平：${level}】
- 语法范围：${spec.grammar}
- 词汇范围：${spec.vocab}
- 句子长度：${spec.sentence}
- 整体语气：${spec.tone}

【必须包含的目标词】
${wordList}
- 每个目标词至少自然出现 1 次，出现时必须处于能让读者靠上下文理解词义的语境中，不能生硬插入、不能同义堆叠，不能让文本读起来像"为了塞词而写"。
- 目标词的语境义可以与词典义有细微差别（更贴近真实使用），但不能超出该词最核心的含义范围。

【文体与场景】
- 文体：${genre}（若为"对话"，用西语常见的对话格式呈现，人物名称简洁好记；若为"说明文"，避免虚构人物，用客观陈述语气）
- 场景：${scenario}

【篇幅——硬性红线】
- 目标区间：${spec.targetWords}
- 绝对不允许超过 150 个西语单词（以空格分隔的词计数，不含标点）。这是不可协商的上限。
- 生成完成后，在心里默数一遍词数；如果超过 150 词，必须在输出前自行删减句子或简化表达，直到低于上限，而不是输出后再说明"字数偏长"。
- 只输出最终的西语正文本身，不要输出词数统计、不要输出解释、不要输出中文翻译、不要输出任何额外说明文字。

现在开始生成正文。`;
}

// ---------------------------------------------------------------------------
// 可选：用户消息侧的最小 user prompt（若你们的 resolveClient() 需要 system + user 两段）
// ---------------------------------------------------------------------------

export function buildStoryUserPrompt({ words, genre, scenario }: Omit<StoryPromptParams, "level">): string {
  return `请生成一篇符合上述要求的西班牙语${genre}，场景为「${scenario}」，必须包含以下目标词：${words.join("、")}。`;
}
