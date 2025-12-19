# Gemini 思维签名（Thought Signature）原理详解

## 1. 什么是思维签名？

思维签名（Thought Signature）是 Gemini 3 模型内部思考过程的**加密表示形式**。它允许模型在多次 API 调用之间**保持推理上下文**，确保模型能够记住之前的思考过程。

## 2. 为什么需要思维签名？

### 2.1 推理连续性
- Gemini 3 是一个推理模型，它会在生成回答前进行内部"思考"
- 在多轮对话或多次工具调用中，模型需要记住之前的推理链
- 思维签名就是这种推理上下文的"指纹"

### 2.2 工具调用的依赖关系
- 当模型调用工具时，它基于之前的思考做出决策
- 工具返回结果后，模型需要基于**相同的思考上下文**来处理结果
- 如果没有思维签名，模型可能会"忘记"为什么调用了这个工具

## 3. 思维签名的出现位置

### 3.1 函数调用（Function Calls）
**单次函数调用**：
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": {
        "name": "check_weather",
        "args": { "city": "Paris" }
      },
      "thoughtSignature": "<Sig_A>"  // ⚠️ 必须保存
    }
  ]
}
```

**并行函数调用**（多个工具同时调用）：
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "check_weather", "args": { "city": "Paris" } },
      "thoughtSignature": "<Sig_A>"  // ⚠️ 只有第一个有签名
    },
    {
      "functionCall": { "name": "check_weather", "args": { "city": "London" } }
      // ⚠️ 第二个没有签名，但必须按顺序返回
    }
  ]
}
```

**多步顺序调用**（工具链）：
```json
// 第一步：调用航班查询
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "check_flight", "args": {...} },
      "thoughtSignature": "<Sig_A>"  // ⚠️ 保存 Sig_A
    }
  ]
}

// 第二步：调用出租车预订（基于航班结果）
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "book_taxi", "args": {...} },
      "thoughtSignature": "<Sig_B>"  // ⚠️ 保存 Sig_B（新的签名）
    }
  ]
}
```

### 3.2 文本/聊天响应
```json
{
  "role": "model",
  "parts": [
    {
      "text": "我需要计算风险...",
      "thoughtSignature": "<Sig_C>"  // ⚠️ 可选，但建议包含
    }
  ]
}
```

### 3.3 图片生成/编辑
```json
{
  "role": "model",
  "parts": [
    {
      "text": "我将生成一个赛博朋克城市...",
      "thoughtSignature": "<Sig_D>"  // ⚠️ 第一部分必须有签名
    },
    {
      "inlineData": { /* 图片数据 */ },
      "thoughtSignature": "<Sig_E>"  // ⚠️ 所有图片部分都必须有签名
    }
  ]
}
```

## 4. 如何传递思维签名？

### 4.1 单次函数调用流程

**第 1 步：模型返回函数调用（带签名）**
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "check_weather", "args": { "city": "Paris" } },
      "thoughtSignature": "<Sig_A>"
    }
  ]
}
```

**第 2 步：用户发送工具结果（必须包含签名）**
```json
[
  {
    "role": "user",
    "parts": [{ "text": "Check weather in Paris" }]
  },
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "check_weather", "args": { "city": "Paris" } },
        "thoughtSignature": "<Sig_A>"  // ⚠️ 必须原样返回
      }
    ]
  },
  {
    "role": "user",
    "parts": [
      {
        "functionResponse": {
          "name": "check_weather",
          "response": { "temp": "15C", "condition": "sunny" }
        }
      }
    ]
  }
]
```

### 4.2 多步顺序调用流程

**场景**：用户问"查看航班，如果延误就预订出租车"

**第 1 步：调用航班工具**
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "check_flight", "args": {...} },
      "thoughtSignature": "<Sig_A>"  // 保存
    }
  ]
}
```

**第 2 步：发送航班结果（包含 Sig_A）**
```json
[
  // ... 之前的对话 ...
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "check_flight", "args": {...} },
        "thoughtSignature": "<Sig_A>"  // ⚠️ 返回 Sig_A
      }
    ]
  },
  {
    "role": "user",
    "parts": [
      {
        "functionResponse": {
          "name": "check_flight",
          "response": { "status": "delayed" }
        }
      }
    ]
  }
]
```

**第 3 步：模型决定预订出租车（生成新签名）**
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "book_taxi", "args": {...} },
      "thoughtSignature": "<Sig_B>"  // 新的签名
    }
  ]
}
```

**第 4 步：发送出租车结果（必须包含所有签名）**
```json
[
  // ... 之前的对话 ...
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "check_flight", "args": {...} },
        "thoughtSignature": "<Sig_A>"  // ⚠️ 返回 Sig_A
      }
    ]
  },
  {
    "role": "user",
    "parts": [{ "functionResponse": { "name": "check_flight", "response": {...} } }]
  },
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "book_taxi", "args": {...} },
        "thoughtSignature": "<Sig_B>"  // ⚠️ 返回 Sig_B
      }
    ]
  },
  {
    "role": "user",
    "parts": [
      {
        "functionResponse": {
          "name": "book_taxi",
          "response": { "taxi_id": "12345" }
        }
      }
    ]
  }
]
```

### 4.3 并行函数调用流程

**场景**：用户问"查看巴黎和伦敦的天气"

**模型响应**：
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "check_weather", "args": { "city": "Paris" } },
      "thoughtSignature": "<Sig_A>"  // ⚠️ 只有第一个有签名
    },
    {
      "functionCall": { "name": "check_weather", "args": { "city": "London" } }
      // ⚠️ 第二个没有签名
    }
  ]
}
```

**用户发送结果**（按顺序返回所有调用）：
```json
[
  {
    "role": "user",
    "parts": [{ "text": "Check weather in Paris and London" }]
  },
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "check_weather", "args": { "city": "Paris" } },
        "thoughtSignature": "<Sig_A>"  // ⚠️ 返回签名
      },
      {
        "functionCall": { "name": "check_weather", "args": { "city": "London" } }
        // ⚠️ 第二个调用没有签名，但必须按顺序返回
      }
    ]
  },
  {
    "role": "user",
    "parts": [
      {
        "functionResponse": { "name": "check_weather", "response": { "temp": "15C" } }
      },
      {
        "functionResponse": { "name": "check_weather", "response": { "temp": "12C" } }
      }
    ]
  }
]
```

## 5. 验证规则

### 5.1 严格验证（必须返回签名）
- **函数调用**：如果模型返回了签名，下一轮必须返回，否则返回 400 错误
- **图片生成/编辑**：所有签名都必须返回，否则返回 400 错误

### 5.2 非严格验证（建议返回）
- **文本/聊天**：验证不是强制的，但省略签名会降低推理能力

## 6. 实现要点

### 6.1 保存签名
- 在收到模型响应时，检查所有 `parts` 中的 `thoughtSignature`
- 将签名与对应的消息/工具调用关联存储

### 6.2 传递签名
- 在构建历史消息时，检查是否有保存的签名
- 在 `convertMessagesToGeminiFormat` 中，将签名添加到对应的 `parts` 中
- **关键**：签名必须放在**对应的 part** 中（函数调用、文本、图片等）

### 6.3 多步调用的签名链
- 对于多步工具调用，需要保存**所有步骤的签名**
- 在发送下一轮请求时，需要返回**整个签名链**

## 7. 示例：完整的多步工具调用

```json
// 轮次 1：用户请求
{
  "role": "user",
  "parts": [{ "text": "查看航班 AA100，如果延误就预订出租车" }]
}

// 轮次 2：模型调用航班工具
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "check_flight", "args": { "flight": "AA100" } },
      "thoughtSignature": "<Sig_A>"
    }
  ]
}

// 轮次 3：用户发送航班结果
{
  "role": "user",
  "parts": [
    {
      "functionResponse": {
        "name": "check_flight",
        "response": { "status": "delayed", "delay": "2 hours" }
      }
    }
  ]
}

// 轮次 4：模型决定预订出租车
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "book_taxi", "args": { "time": "2 hours later" } },
      "thoughtSignature": "<Sig_B>"
    }
  ]
}

// 轮次 5：用户发送出租车结果（必须包含所有签名）
[
  {
    "role": "user",
    "parts": [{ "text": "查看航班 AA100，如果延误就预订出租车" }]
  },
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "check_flight", "args": {...} },
        "thoughtSignature": "<Sig_A>"  // ⚠️ 返回 Sig_A
      }
    ]
  },
  {
    "role": "user",
    "parts": [{ "functionResponse": { "name": "check_flight", "response": {...} } }]
  },
  {
    "role": "model",
    "parts": [
      {
        "functionCall": { "name": "book_taxi", "args": {...} },
        "thoughtSignature": "<Sig_B>"  // ⚠️ 返回 Sig_B
      }
    ]
  },
  {
    "role": "user",
    "parts": [
      {
        "functionResponse": {
          "name": "book_taxi",
          "response": { "taxi_id": "12345" }
        }
      }
    ]
  }
]
```

## 8. 注意事项

1. **签名必须原样返回**：不能修改、不能省略
2. **顺序很重要**：对于并行调用，必须按接收顺序返回
3. **所有签名都要返回**：对于多步调用，需要返回所有累积的签名
4. **签名位置要正确**：签名必须放在对应的 `part` 中，不能放错位置
5. **从其他模型迁移**：如果从其他模型（如 Gemini 2.5）迁移，可以使用虚拟字符串 `"context_engineering_is_the_way_to_go"` 绕过验证
