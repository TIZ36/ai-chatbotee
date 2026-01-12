# RAG 功能检查与优化方案

## 当前实现状态

### 1. 已实现的功能

- ✅ **ChromaDB 集成**：已通过 HTTP API 实现 ChromaDB Repository
- ✅ **RAG Handler**：在 `chain_manager.go` 中实现了 `handleRAG` 方法
- ✅ **向量检索**：支持通过 ChromaDB 进行向量相似度搜索
- ✅ **结果格式化**：将检索结果转换为标准格式并注入到 ChainContext

### 2. 存在的问题

#### 2.1 Embedding 生成问题（关键）

**当前实现**：
- `generateEmbedding` 方法使用简单的 hash 算法生成伪向量
- 这不是真正的语义 embedding，无法进行有效的语义搜索

**问题影响**：
- RAG 检索结果不准确
- 无法利用向量相似度进行语义匹配

#### 2.2 LLM Provider 访问问题

**当前代码**：
```go
provider, err := cm.svc.cfg.LLMRegistry.Get("deepseek")
```

**问题**：
- `LLMRegistry.Get` 返回 `(Provider, bool)`，不是 `(Provider, error)`
- 需要检查 Service 结构以正确访问 LLMRegistry

### 3. 优化方案

#### 方案 1：使用 OpenAI Embedding API（推荐）

**优势**：
- 项目已集成 `github.com/sashabaranov/go-openai`
- 支持多种 embedding 模型（text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002）
- 质量高，适合生产环境

**实现步骤**：
1. ✅ 已创建 `EmbeddingProvider` 接口
2. ✅ 已在 `OpenAIProvider` 中实现 `CreateEmbedding` 方法
3. ⚠️ 需要修复 `generateEmbedding` 方法以正确访问 LLMRegistry
4. ⚠️ 需要处理错误和降级策略

#### 方案 2：使用本地 Embedding 模型

**选项**：
- 通过 HTTP 调用 sentence-transformers 服务
- 使用 ONNX Runtime Go 绑定运行本地模型
- 使用 ChromaDB 的内置 embedding 功能（如果支持）

**优势**：
- 无需 API 调用，成本低
- 数据隐私更好

**劣势**：
- Go 生态中 embedding 库较少
- 需要额外的服务或依赖

#### 方案 3：混合方案

**策略**：
- 优先使用 OpenAI/DeepSeek 等 API
- 如果 API 不可用，降级到本地模型或占位符
- 支持配置选择 embedding 提供商

### 4. 参考的开源 RAG 实现

#### 4.1 LangChain（Python，70k+ stars）

**架构特点**：
- 模块化设计，支持多种 embedding 提供商
- 支持本地和云端 embedding 模型
- 完善的文档和示例

**可借鉴点**：
- Embedding 提供商的抽象接口
- 多提供商支持策略
- 错误处理和重试机制

#### 4.2 LlamaIndex（Python，70k+ stars）

**架构特点**：
- 专注于 RAG 应用
- 支持多种向量数据库
- 优化的检索策略

**可借鉴点**：
- 检索结果排序和过滤
- 上下文窗口管理
- 多轮对话的上下文处理

#### 4.3 FAISS（C++，Python，20k+ stars）

**特点**：
- 高效的向量相似度搜索
- 支持大规模向量库
- 多种索引算法

**可借鉴点**：
- 向量索引优化
- 批量查询处理
- 距离计算优化

### 5. 具体优化建议

#### 5.1 修复 Embedding 生成

```go
// 修复后的 generateEmbedding 方法
func (cm *ChainManager) generateEmbedding(ctx context.Context, text string) ([]float32, error) {
    // 1. 尝试从 LLMRegistry 获取 embedding provider
    providers := []string{"openai", "deepseek", "openrouter"}
    
    var embeddingProvider llm.EmbeddingProvider
    for _, name := range providers {
        if provider, ok := cm.svc.cfg.LLMRegistry.Get(name); ok {
            if ep, ok := provider.(llm.EmbeddingProvider); ok {
                embeddingProvider = ep
                break
            }
        }
    }
    
    if embeddingProvider == nil {
        // 降级策略：返回错误或使用占位符
        return nil, fmt.Errorf("no embedding provider available")
    }
    
    // 2. 调用 embedding API
    resp, err := embeddingProvider.CreateEmbedding(ctx, []string{text}, "")
    if err != nil {
        return nil, fmt.Errorf("failed to create embedding: %w", err)
    }
    
    if len(resp.Embeddings) == 0 {
        return nil, fmt.Errorf("empty embedding response")
    }
    
    return resp.Embeddings[0], nil
}
```

#### 5.2 添加配置支持

```yaml
# config.yaml
rag:
  embedding:
    provider: "openai"  # openai, deepseek, local
    model: "text-embedding-3-small"
    fallback: true  # 如果 API 失败，是否使用占位符
```

#### 5.3 优化检索结果处理

```go
// 在 handleRAG 中添加结果过滤和排序
func (cm *ChainManager) handleRAG(ctx *actor.ChainContext, step *actor.ActionStep) error {
    // ... 现有代码 ...
    
    // 添加结果过滤（基于距离阈值）
    filteredResults := make([]map[string]interface{}, 0)
    maxDistance := 0.8 // 可配置
    for _, item := range results {
        if score, ok := item["score"].(float64); ok && score >= (1.0-maxDistance) {
            filteredResults = append(filteredResults, item)
        }
    }
    
    // 按分数排序
    sort.Slice(filteredResults, func(i, j int) bool {
        scoreI, _ := filteredResults[i]["score"].(float64)
        scoreJ, _ := filteredResults[j]["score"].(float64)
        return scoreI > scoreJ
    })
    
    ctx.Variables["rag_results"] = filteredResults
    // ... 其余代码 ...
}
```

#### 5.4 添加缓存机制

```go
// 缓存 embedding 结果，避免重复计算
type EmbeddingCache struct {
    mu    sync.RWMutex
    cache map[string][]float32
}

func (ec *EmbeddingCache) Get(text string) ([]float32, bool) {
    ec.mu.RLock()
    defer ec.mu.RUnlock()
    emb, ok := ec.cache[text]
    return emb, ok
}

func (ec *EmbeddingCache) Set(text string, embedding []float32) {
    ec.mu.Lock()
    defer ec.mu.Unlock()
    ec.cache[text] = embedding
}
```

### 6. 实施优先级

1. **高优先级**：
   - ✅ 修复 `generateEmbedding` 以使用真正的 embedding API
   - ✅ 修复 LLMRegistry 访问方式
   - ✅ 添加错误处理和降级策略

2. **中优先级**：
   - 添加 embedding 缓存
   - 优化检索结果处理
   - 添加配置支持

3. **低优先级**：
   - 支持本地 embedding 模型
   - 添加批量 embedding 生成
   - 性能监控和指标

### 7. 测试建议

1. **单元测试**：
   - 测试 embedding 生成
   - 测试 ChromaDB 查询
   - 测试结果格式化

2. **集成测试**：
   - 测试完整的 RAG 流程
   - 测试错误处理
   - 测试降级策略

3. **性能测试**：
   - Embedding 生成延迟
   - 向量检索性能
   - 缓存命中率

### 8. 下一步行动

1. 修复 `generateEmbedding` 方法以正确访问 LLMRegistry
2. 测试 OpenAI Embedding API 集成
3. 添加配置和错误处理
4. 优化检索结果处理
5. 添加缓存机制

