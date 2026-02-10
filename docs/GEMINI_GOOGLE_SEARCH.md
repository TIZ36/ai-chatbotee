# Gemini 联网搜索（Google Search Grounding）

使用 Gemini API 的 **Google Search Grounding** 能力，可以让模型在回答时自动检索实时网页并引用来源，适合需要“联网”的问答场景。

## 如何开启

### 1. 在 LLM 配置里开启（推荐）

1. 打开 **设置 → LLM 配置**（或对应入口）。
2. 选择或新建一个 **Gemini / Google** 的配置（需填写有效的 API Key）。
3. 在配置中找到 **「启用联网搜索（Google Search）」** 开关，打开即可。
4. 保存后，使用该配置的对话会自动带上联网搜索能力。

### 2. 配置项说明

- **metadata.enableGoogleSearch**：为 `true` 时，请求会带上 `tools: [{ googleSearch: {} }]`，模型可自行决定是否发起搜索并引用网页。
- 前端（直接调 Gemini）与后端（通过代理/Agent 调 Gemini）均已支持；后端会从配置的 `metadata.enableGoogleSearch` 或 `enable_google_search` 读取。

## 支持的模型

- Gemini 2.5 Pro / 2.5 Flash / 2.5 Flash-Lite  
- Gemini 2.0 Flash  
- Gemini 1.5 Pro / 1.5 Flash  

（以 [官方文档](https://ai.google.dev/gemini-api/docs/grounding) 为准。）

## 计费说明

- 使用 Grounding with Google Search 会按 Google 定价计费（例如约 $35/1000 次 grounded 查询，具体见 [Gemini API 定价](https://ai.google.dev/gemini-api/docs/pricing)）。
- 仅在模型**实际执行了搜索**时计费，未触发搜索的请求不额外收费。

## 与 MCP 工具一起使用

同一条配置下可以同时开启「联网搜索」和 MCP 工具（如 Playwright）：请求中会同时带上 `googleSearch` 与 `functionDeclarations`，模型可自由选择是否搜索、是否调工具。
