import { NextResponse } from "next/server";
import { getRecommendedArticles } from "../_lib/articles";

export async function GET() {
  try {
    const articles = await getRecommendedArticles();
    return NextResponse.json({ articles });
  } catch (error) {
    console.error("外刊推荐获取失败:", error);
    return NextResponse.json({ articles: [] }, { status: 200 });
  }
}
