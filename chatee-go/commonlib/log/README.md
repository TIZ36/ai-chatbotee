# 日志库实现说明

## 日志库选择

本项目选择了 **Uber Zap** (`go.uber.org/zap`) 作为日志库，原因如下：

### Zap 的优势

1. **高性能**：Zap 是 Go 生态中性能最高的结构化日志库之一
   - 零分配设计，减少 GC 压力
   - 比标准库 `log` 快 4-10 倍
   - 比 `logrus` 快 2-3 倍

2. **结构化日志**：原生支持结构化日志记录
   - JSON 格式输出，便于日志收集和分析
   - 支持丰富的字段类型

3. **灵活配置**：支持多种输出格式和级别
   - JSON 格式（生产环境推荐）
   - Console 格式（开发环境友好）
   - 可配置的日志级别

4. **社区活跃**：Uber 开源，社区活跃，维护良好

### 其他可选方案对比

| 日志库 | 性能 | 结构化 | 易用性 | 推荐场景 |
|--------|------|--------|--------|----------|
| **zap** | ⭐⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐ | 高性能生产环境 |
| logrus | ⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ | 简单易用，中小型项目 |
| zerolog | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐ | 零分配，性能优秀 |
| 标准库 log | ⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ | 简单场景 |

## 实现特性

### 1. 日志级别
- `Debug`：调试信息
- `Info`：一般信息
- `Warn`：警告信息
- `Error`：错误信息
- `Fatal`：致命错误（会退出程序）

### 2. 输出格式
- **JSON**：结构化输出，适合生产环境和日志收集系统
- **Console**：人类可读格式，适合开发环境

### 3. 输出目标
- `stdout`：标准输出（默认）
- `stderr`：标准错误输出
- 文件路径：输出到文件，支持日志轮转

### 4. 日志轮转
使用 `lumberjack` 实现日志轮转功能：
- `MaxSize`：单个日志文件最大大小（MB，默认 100MB）
- `MaxBackups`：保留的备份文件数量（默认 3 个）
- `MaxAge`：日志文件保留天数（默认 30 天）
- `Compress`：是否压缩旧日志文件（默认开启）

### 5. Context 支持
自动从 context 中提取以下字段：
- `request_id`：请求 ID
- `user_id`：用户 ID
- `session_id`：会话 ID
- `trace_id`：追踪 ID
- `span_id`：跨度 ID

## 使用示例

### 基本使用

```go
import "chatee-go/commonlib/log"

// 初始化日志
log.Init(log.LogConfig{
    Level:      "info",
    Format:     "json",
    OutputPath: "stdout",
    AddCaller:  true,
})

// 使用全局日志
log.Info("服务启动", log.String("port", "8080"))
log.Error("处理失败", log.Err(err))

// 获取 logger 实例
logger := log.Default()
logger.Debug("调试信息", log.String("key", "value"))
```

### 带 Context 的日志

```go
import (
    "context"
    "chatee-go/commonlib/log"
)

// 添加追踪信息到 context
ctx := log.WithRequestID(context.Background(), "req-123")
ctx = log.WithUserID(ctx, "user-456")

// 使用带 context 的日志
logger := log.L(ctx)
logger.Info("处理请求") // 会自动包含 request_id 和 user_id
```

### 自定义字段

```go
logger.Info("用户登录",
    log.String("username", "alice"),
    log.Int("age", 30),
    log.Bool("active", true),
    log.Duration("latency", time.Since(start)),
    log.Any("metadata", map[string]interface{}{
        "ip": "192.168.1.1",
    }),
)
```

### 日志轮转配置

```go
log.Init(log.LogConfig{
    Level:      "info",
    Format:     "json",
    OutputPath: "/var/log/chatee/app.log", // 文件路径
    AddCaller:  true,
    MaxSize:    100,    // 100MB
    MaxBackups: 5,      // 保留 5 个备份
    MaxAge:     30,     // 保留 30 天
    Compress:   true,   // 压缩旧日志
})
```

## 配置说明

在 `config.yaml` 中配置：

```yaml
log:
  level: info          # debug, info, warn, error
  format: json         # json, console
  output_path: stdout  # stdout, stderr, 或文件路径
  max_size: 100       # MB
  max_backups: 3      # 备份文件数量
  max_age: 30         # 保留天数
```

## 最佳实践

1. **生产环境**：使用 JSON 格式，输出到文件，启用日志轮转
2. **开发环境**：使用 Console 格式，输出到 stdout，便于调试
3. **错误处理**：使用 `log.Err(err)` 记录错误，而不是 `log.Error(err)`
4. **性能敏感**：避免在高频路径中使用 Debug 级别日志
5. **结构化数据**：尽量使用结构化字段，而不是字符串拼接

## 依赖

- `go.uber.org/zap`：核心日志库
- `gopkg.in/natefinch/lumberjack.v2`：日志轮转库

