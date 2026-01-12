# LLM Provider 实现文档

## 概述

本项目已实现支持多种 LLM 供应商的统一接口，包括：
- ✅ **OpenAI** - 支持 GPT 系列模型
- ✅ **DeepSeek** - 支持 DeepSeek 模型（OpenAI 兼容 API）
- ✅ **Anthropic (Claude)** - 支持 Claude 系列模型
- ✅ **Google Gemini** - 支持 Gemini 系列模型

## 架构设计

### 核心接口

```go
// Provider 接口定义了所有 LLM provider 必须实现的方法
type Provider interface {
    Name() string
    Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error)
    ChatStream(ctx context.Context, req *ChatRequest) (<-chan StreamEvent, error)
    ListModels(ctx context.Context) ([]ModelInfo, error)
    CountTokens(ctx context.Context, messages []Message) (int, error)
}

// EmbeddingProvider 接口用于支持 embedding 的 provider
type EmbeddingProvider interface {
    CreateEmbedding(ctx context.Context, texts []string, model string) (*EmbeddingResponse, error)
}
```

### Provider 实现

#### 1. OpenAI Provider (`openai.go`)
- **支持模型**: GPT-4, GPT-3.5, 等
- **API 端点**: `https://api.openai.com/v1`
- **特性**:
  - ✅ Chat 完成
  - ✅ 流式响应
  - ✅ 工具调用 (Function Calling)
  - ✅ Embedding 生成
  - ✅ Token 计数

#### 2. DeepSeek Provider
- **支持模型**: deepseek-chat, deepseek-reasoner 等
- **API 端点**: `https://api.deepseek.com/v1`
- **实现**: 复用 OpenAI Provider（OpenAI 兼容 API）
- **特性**: 与 OpenAI Provider 相同

#### 3. Anthropic Provider (`anthropic.go`)
- **支持模型**: 
  - claude-3-5-sonnet-20241022
  - claude-3-opus-20240229
  - claude-3-sonnet-20240229
  - claude-3-haiku-20240307
- **API 端点**: `https://api.anthropic.com/v1`
- **特性**:
  - ✅ Chat 完成
  - ✅ 流式响应
  - ✅ 工具调用
  - ✅ System message 支持
  - ❌ Embedding（Anthropic 不支持）

#### 4. Google Gemini Provider (`gemini.go`)
- **支持模型**: gemini-2.0-flash-exp, gemini-1.5-pro 等
- **API 端点**: `https://generativelanguage.googleapis.com/v1beta`
- **特性**:
  - ✅ Chat 完成
  - ✅ 流式响应
  - ✅ 工具调用
  - ✅ System instruction 支持
  - ✅ 多模态支持（图片）
  - ❌ Embedding（Gemini 不支持标准 embedding API）

## 使用示例

### 1. 创建 Provider

```go
import "chatee-go/commonlib/llm"

// 方式 1: 使用 Factory
config := llm.ProviderConfig{
    Type:   "openai",
    APIKey: "sk-...",
}
provider, err := llm.CreateProvider(config)

// 方式 2: 直接创建
openaiProvider := llm.NewOpenAIProvider(llm.OpenAIConfig{
    Name:   "openai",
    APIKey: "sk-...",
})
```

### 2. 发送 Chat 请求

```go
ctx := context.Background()
req := &llm.ChatRequest{
    Model: "gpt-4",
    Messages: []llm.Message{
        {Role: "system", Content: "You are a helpful assistant."},
        {Role: "user", Content: "Hello!"},
    },
    Temperature: float64Ptr(0.7),
    MaxTokens:   intPtr(1000),
}

resp, err := provider.Chat(ctx, req)
if err != nil {
    log.Fatal(err)
}

fmt.Println(resp.Message.Content)
```

### 3. 流式响应

```go
stream, err := provider.ChatStream(ctx, req)
if err != nil {
    log.Fatal(err)
}

for event := range stream {
    switch event.Type {
    case "content":
        fmt.Print(event.Delta) // 实时输出
    case "done":
        fmt.Println("\n完成")
    case "error":
        log.Fatal(event.Error)
    }
}
```

### 4. 生成 Embedding

```go
// 检查 provider 是否支持 embedding
if embeddingProvider, ok := provider.(llm.EmbeddingProvider); ok {
    resp, err := embeddingProvider.CreateEmbedding(ctx, []string{"Hello world"}, "text-embedding-3-small")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Embedding dimension: %d\n", len(resp.Embeddings[0]))
}
```

### 5. 使用 Registry

```go
registry := llm.NewRegistry()

// 注册 provider
registry.Register("my-openai", openaiProvider)

// 获取 provider
provider, ok := registry.Get("my-openai")
if !ok {
    log.Fatal("Provider not found")
}

// 列出所有 provider
providers := registry.List()
```

## 配置

### Provider 配置结构

```go
type ProviderConfig struct {
    Type    string            // Provider 类型: openai, deepseek, anthropic, gemini
    APIKey  string            // API 密钥
    BaseURL string            // 自定义 API 端点（可选）
    Options map[string]string // Provider 特定选项（可选）
}
```

### 支持的 Provider 类型

| Type | 别名 | 说明 |
|------|------|------|
| `openai` | - | OpenAI API |
| `deepseek` | - | DeepSeek API (OpenAI 兼容) |
| `anthropic` | `claude`, `claudecode` | Anthropic Claude API |
| `gemini` | `google` | Google Gemini API |

## 测试

运行测试：

```bash
go test ./commonlib/llm/... -v
```

测试覆盖：
- ✅ Provider Registry 测试
- ✅ Provider 创建测试
- ✅ 各 Provider 基本功能测试
- ✅ Embedding Provider 接口测试
- ✅ 配置验证测试
- ✅ 性能基准测试

## 性能优化

### 1. 连接池
- 所有 Provider 使用 `http.Client` 进行 HTTP 请求
- 默认超时时间：120 秒
- 支持连接复用

### 2. 流式处理
- 使用 channel 进行流式数据传输
- 非阻塞设计，支持并发处理

### 3. 错误处理
- 统一的错误格式
- 详细的错误信息
- 优雅的降级策略

## 扩展指南

### 添加新的 Provider

1. **实现 Provider 接口**

```go
type MyProvider struct {
    // ... fields
}

func (p *MyProvider) Name() string { return "my-provider" }
func (p *MyProvider) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
    // 实现逻辑
}
// ... 实现其他方法
```

2. **在 Factory 中注册**

```go
// 在 factory.go 的 CreateProvider 函数中添加
case "my-provider":
    return NewMyProvider(MyProviderConfig{
        APIKey: config.APIKey,
        // ...
    }), nil
```

3. **添加测试**

在 `provider_test.go` 中添加测试用例。

## 参考实现

本实现参考了 `~/aiproj/ai-chatbotee/backend` 中的 Python 实现：
- `services/providers/openai_provider.py`
- `services/providers/anthropic_provider.py`
- `services/providers/google_provider.py`
- `services/providers/factory.py`

## 已知限制

1. **Embedding 支持**:
   - ✅ OpenAI/DeepSeek: 完全支持
   - ❌ Anthropic: 不支持（API 限制）
   - ❌ Gemini: 不支持（API 限制）

2. **多模态支持**:
   - ✅ Gemini: 支持图片输入/输出
   - ⚠️ OpenAI: 部分支持（需要特定模型）
   - ❌ Anthropic: 不支持图片生成

3. **工具调用**:
   - ✅ 所有 Provider 都支持 Function Calling
   - ⚠️ 不同 Provider 的工具格式略有差异

## 未来改进

- [ ] 添加本地模型支持（Ollama）
- [ ] 实现更精确的 Token 计数
- [ ] 添加请求重试机制
- [ ] 实现请求缓存
- [ ] 添加性能监控和指标
- [ ] 支持批量请求

