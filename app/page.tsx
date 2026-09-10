import HomeClient from "./HomeClient";
import { getRecommendedArticles } from "./api/_lib/articles";

export default async function Home() {
  let articles: Awaited<ReturnType<typeof getRecommendedArticles>> = [];
  try {
    articles = await getRecommendedArticles();
  } catch (error) {
    console.error("外刊推荐获取失败:", error);
  }

  return <HomeClient initialArticles={articles} />;
}
