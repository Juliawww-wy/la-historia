import { NextRequest, NextResponse } from "next/server";
import { resolveClient } from "../_lib/ai-client";
import {
  buildStorySystemPrompt,
  buildStoryUserPrompt,
  type StoryGenre,
  type StoryLevel,
  type StoryScenario,
} from "../_lib/storyPrompts";

const STORY_LEVELS: StoryLevel[] = ["A2", "B1", "B2", "C1"];
const STORY_GENRES: StoryGenre[] = ["故事", "对话", "说明文"];
const STORY_SCENARIOS: StoryScenario[] = ["校园", "日常生活", "旅行", "留学", "考试阅读"];

export async function POST(request: NextRequest) {
  try {
    const { words, level, genre, scenario, apiConfig } = await request.json();

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: "words 不能为空，且必须是字符串数组" },
        { status: 400 }
      );
    }
    if (!level || !STORY_LEVELS.includes(level)) {
      return NextResponse.json(
        { error: `level 必须是 ${STORY_LEVELS.join("、")} 之一` },
        { status: 400 }
      );
    }
    if (!genre || !STORY_GENRES.includes(genre)) {
      return NextResponse.json(
        { error: `genre 必须是 ${STORY_GENRES.join("、")} 之一` },
        { status: 400 }
      );
    }
    if (!scenario || !STORY_SCENARIOS.includes(scenario)) {
      return NextResponse.json(
        { error: `scenario 必须是 ${STORY_SCENARIOS.join("、")} 之一` },
        { status: 400 }
      );
    }

    const { client, model } = resolveClient(apiConfig);

    const response = await client.chat.completions.create({
      model,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: buildStorySystemPrompt({ level, words, genre, scenario }),
        },
        { role: "user", content: buildStoryUserPrompt({ words, genre, scenario }) },
      ],
    });

    const storyText = response.choices[0].message.content ?? "";

    return NextResponse.json({ story: storyText.trim() });
  } catch (error) {
    console.error("故事生成失败:", error);
    const message =
      error instanceof Error && /apiConfig/i.test(error.message)
        ? error.message
        : "故事生成失败，请检查 API 设置或重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
