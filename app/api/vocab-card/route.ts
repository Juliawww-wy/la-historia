import { NextRequest, NextResponse } from "next/server";
import { resolveClient } from "../_lib/ai-client";

const VOCAB_PROMPT = `You are a Spanish vocabulary learning assistant designed for Chinese learners of Spanish (A2-B2 level).

Your job is to return a structured vocabulary card in JSON format.
Return ONLY the JSON object, no explanation, no markdown, no code blocks.

Example output format:
{
  "word": "原词",
  "part_of_speech": "词性（名词/动词/形容词等，用中文）",
  "context_meaning": {
    "zh": "这个词在原句中的具体含义（中文，1句话，贴合语境）",
    "explanation": "为什么在这个句子里是这个意思，如有歧义请说明（中文，1-2句）"
  },
  "general_meaning": {
    "zh": "这个词最常见的中文释义（可列1-3个义项）",
    "en": "English translation(s)",
    "es": "Definición en español (simple, B1 level)"
  },
  "original_sentence": "原句原文",
  "original_sentence_translation": "原句中文翻译"
}`;

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

export async function POST(request: NextRequest) {
  try {
    const { target_word, original_sentence, apiConfig } = await request.json();

    if (!target_word || !original_sentence) {
      return NextResponse.json(
        { error: "target_word 和 original_sentence 不能为空" },
        { status: 400 }
      );
    }

    const { client, model } = resolveClient(apiConfig);

    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: VOCAB_PROMPT },
        {
          role: "user",
          content: "Target word: " + target_word + "\nOriginal sentence: " + original_sentence,
        },
      ],
    });

    const rawText = response.choices[0].message.content ?? "";

    let vocabCard;
    try {
      vocabCard = JSON.parse(extractJson(rawText));
    } catch {
      throw new Error("模型返回的内容不是有效的 JSON，请检查所选模型是否支持结构化输出");
    }

    return NextResponse.json(vocabCard);
  } catch (error) {
    console.error("词卡生成失败:", error);
    const message =
      error instanceof Error && error.message.includes("JSON")
        ? error.message
        : "词卡生成失败，请检查 API 设置或重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
