import { NextRequest, NextResponse } from "next/server";
import { resolveClient } from "../_lib/ai-client";

const QUIZ_PROMPT = `You are a Spanish language quiz generator for Chinese learners.

Given a Spanish passage and a list of target vocabulary words, generate exactly 3 fill-in-the-blank questions based on the passage content. Each question must:
- Use a sentence from or closely based on the passage, with one word replaced by ___
- Prioritize the provided target vocabulary words as the correct answers when possible
- Provide exactly 4 options (A, B, C, D) where only one is correct
- Have distractors that are plausible but clearly wrong in context

Return ONLY a JSON object in this exact format, with no explanation, no markdown, and no code blocks:
{
  "questions": [
    {
      "type": "fill_blank",
      "sentence": "sentence with ___ as the blank",
      "options": ["option A", "option B", "option C", "option D"],
      "answer": "correct option"
    }
  ]
}`;

function extractJson(raw: string): string {
  // Some providers wrap JSON in ```json ... ``` even when told not to.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

export async function POST(request: NextRequest) {
  try {
    const { story, words, apiConfig } = await request.json();

    if (!story || typeof story !== "string" || story.trim() === "") {
      return NextResponse.json({ error: "story 不能为空" }, { status: 400 });
    }
    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: "words 不能为空，且必须是字符串数组" },
        { status: 400 }
      );
    }

    const { client, model } = resolveClient(apiConfig);

    const userMessage =
      `Story:\n${story}\n\nTarget vocabulary words: ${words.join(", ")}`;

    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: QUIZ_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const rawText = response.choices[0].message.content ?? "";

    let quiz;
    try {
      quiz = JSON.parse(extractJson(rawText));
    } catch {
      throw new Error("模型返回的内容不是有效的 JSON，请检查所选模型是否支持结构化输出");
    }

    return NextResponse.json(quiz);
  } catch (error) {
    console.error("题目生成失败:", error);
    const message =
      error instanceof Error && error.message.includes("JSON")
        ? error.message
        : "题目生成失败，请检查 API 设置或重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
