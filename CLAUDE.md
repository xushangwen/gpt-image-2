@AGENTS.md
@.claude/rules/responsive.md

## 项目信息
- 项目名：GPT Image 2
- 技术栈：Next.js App Router
- 部署：Vercel
- AI API：OpenAI gpt-image-2

## Gemini API 规范
- 图片下载必须 Canvas 重绘 → `toBlob('image/jpeg', 0.95)` → `createObjectURL`，后缀 `.jpg`
- 禁止用 `imageGenerationConfig`（`gemini-*-flash-*` 不支持，报 `Unknown name`）
- 宽高比通过提示词文本引导，如 `portrait orientation 9:16`
- API key 放服务端 Route Handler + `.env.local`，禁止出现在前端代码

## Git 规范
- 问"未提交/未推送"时直接跑 `git status` + `git log origin/main..HEAD`
- 完成一组改动后主动提示是否 commit + push
