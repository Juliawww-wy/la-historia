# La Historia
AI-powered Spanish vocabulary learning tool for Chinese learners — turns unfamiliar words into contextual stories and micro-exercises

帮助中文母语者学西班牙语：粘贴一段西语文本 → 选出不认识的词 → AI 用这些词生成一篇新故事 → 点词看词卡 → 生成小测验巩固。

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Create a `.env.local` in the project root (never commit real secrets):

```bash
# ── LLM 默认后端（故事 / 词卡 / 测验；用户也可在设置里 BYOK）──────────────
DEEPSEEK_API_KEY=sk-...

# ── 机器翻译（Stage 1 粘贴/导入文本的中文大意，不走 LLM）──────────────────
# 在百度翻译开放平台申请通用文本翻译 API：https://fanyi-api.baidu.com/
# 标准版每月约 5 万字符免费。把 APP ID 和密钥填到下面两个变量。
BAIDU_TRANSLATE_APPID=your_app_id
BAIDU_TRANSLATE_KEY=your_secret_key
```

| Variable | Used by | Notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | `/api/story`, `/api/quiz`, `/api/vocab-card` | Platform fallback when the user has not set a custom API in Settings |
| `BAIDU_TRANSLATE_APPID` | `/api/translate` | Baidu Fanyi app id |
| `BAIDU_TRANSLATE_KEY` | `/api/translate` | Baidu Fanyi secret key |

Stage-1 translation is intentionally a traditional machine-translation call (Baidu by default), not `resolveClient` / BYOK LLM, so paste/import traffic does not burn token quota. The provider is abstracted under `app/api/_lib/translate/` if you later switch to Volcengine or Niutrans.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Baidu Translate API docs](https://fanyi-api.baidu.com/doc/21)
