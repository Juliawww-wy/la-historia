import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

const STORY_PROMPT = `You are a Spanish writing assistant for Chinese learners of Spanish.

Given a list of vocabulary words, a proficiency level, and a genre, write a Spanish passage that:
- Is exactly 150-200 words long
- Naturally incorporates ALL the provided vocabulary words
- Matches the difficulty of the specified level (A2: simple sentences and common vocabulary; B1: varied sentence structures and everyday topics; B2: complex sentences, nuanced expressions, and abstract topics)
- Follows the specified genre (故事: narrative short story with characters and plot; 对话: dialogue between two or more people; 说明文: expository text explaining a concept or process)

Return ONLY the Spanish passage text, with no title, no labels, no explanation, and no additional content.`;

export async function POST(request: NextRequest) {
  try {
    const { words, level, genre } = await request.json();

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: "words 不能为空，且必须是字符串数组" },
        { status: 400 }
      );
    }
    if (!level || !["A2", "B1", "B2"].includes(level)) {
      return NextResponse.json(
        { error: 'level 必须是 "A2"、"B1" 或 "B2" 之一' },
        { status: 400 }
      );
    }
    if (!genre || !["故事", "对话", "说明文"].includes(genre)) {
      return NextResponse.json(
        { error: 'genre 必须是 "故事"、"对话" 或 "说明文" 之一' },
        { status: 400 }
      );
    }

    const userMessage =
      `Level: ${level}\nGenre: ${genre}\nWords to include: ${words.join(", ")}`;

    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      max_tokens: 512,
      messages: [
        { role: "system", content: STORY_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const storyText = response.choices[0].message.content ?? "";

    return NextResponse.json({ story: storyText.trim() });
  } catch (error) {
    console.error("故事生成失败:", error);
    return NextResponse.json(
      { error: "故事生成失败，请重试" },
      { status: 500 }
    );
  }
}
