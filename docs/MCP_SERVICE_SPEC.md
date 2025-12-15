# MCP 服务开发规范

本文档定义了 MCP (Model Context Protocol) 服务器的开发规范，确保与本系统的兼容性和稳定性。

## 1. 必须实现的接口

### 1.1 健康检查接口 `/health`

**要求级别**: 必须 (REQUIRED)

MCP 服务器**必须**实现标准的健康检查接口，用于客户端检测服务器的可用性和健康状态。

#### 接口规范

```
GET /health
```

#### 响应格式

**健康状态**（HTTP 200）:
```json
{
  "status": "healthy"
}
```

或者（也支持）:
```json
{
  "status": "ok"
}
```

或者:
```json
{
  "healthy": true
}
```

或者:
```json
{
  "ok": true
}
```

**不健康状态**（HTTP 200 或 503）:
```json
{
  "status": "unhealthy",
  "reason": "数据库连接失败"  // 可选：说明原因
}
```

#### 示例实现

**Python (Flask)**:
```python
from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health_check():
    # 执行健康检查逻辑
    try:
        # 检查数据库连接
        # 检查依赖服务
        # ...
        return jsonify({'status': 'healthy'}), 200
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'reason': str(e)
        }), 503
```

**Node.js (Express)**:
```javascript
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
    // 执行健康检查逻辑
    try {
        // 检查依赖服务
        res.json({ status: 'healthy' });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            reason: error.message
        });
    }
});
```

**Go**:
```go
package main

import (
    "encoding/json"
    "net/http"
)

func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    
    // 执行健康检查逻辑
    healthy := true // 替换为实际检查逻辑
    
    if healthy {
        json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
    } else {
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy"})
    }
}

func main() {
    http.HandleFunc("/health", healthHandler)
    http.ListenAndServe(":8080", nil)
}
```

## 2. 健康检查最佳实践

### 2.1 检查项目

健康检查应该验证以下内容：

1. **服务可用性**: 服务进程正在运行
2. **依赖服务**: 数据库、缓存、外部 API 等是否可用
3. **资源状态**: 内存、磁盘空间等是否充足
4. **配置有效性**: 必要的配置是否正确加载

### 2.2 响应时间

健康检查接口应该快速响应：
- 目标响应时间: < 1 秒
- 超时阈值: 5 秒

如果健康检查涉及耗时操作，应该：
- 使用缓存的状态信息
- 在后台线程中执行实际检查
- 返回上次检查的结果

### 2.3 详细信息（可选）

可以返回更详细的健康信息：

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 5
    },
    "cache": {
      "status": "healthy",
      "latency_ms": 1
    }
  }
}
```

## 3. 不符合规范的影响

如果 MCP 服务器**未实现** `/health` 接口：

1. **警告提示**: 系统会在日志中输出警告，提示服务不符合规范
2. **回退机制**: 系统会使用 `tools/list` 接口作为健康检查的回退方案
3. **性能影响**: 回退方案的开销更大，可能影响连接池效率
4. **稳定性风险**: 无法准确检测服务器健康状态，可能导致：
   - 使用已断开的连接
   - 重连延迟增加
   - 错误率上升

## 4. 连接管理说明

本系统的 MCP 连接管理机制：

### 4.1 连接池

- 每个 MCP 服务器维护一个连接池
- 默认最大连接数: 10
- 空闲超时: 5 分钟

### 4.2 健康检查触发时机

- 从连接池获取连接时
- 连接空闲超过 30 秒后
- 连接发生错误时

### 4.3 自动重连

当检测到连接不健康时，系统会：

1. 销毁不健康的连接
2. 从连接池中移除
3. 自动创建新连接（最多重试 3 次）
4. 使用指数退避策略（1秒、2秒、3秒）

### 4.4 错误处理

以下错误会触发连接标记为不健康：

- 网络错误 (network)
- 连接超时 (timeout)
- 连接被拒绝 (ECONNREFUSED)
- 连接重置 (ECONNRESET)
- Socket 错误
- 会话错误 (session)
- 传输层错误 (transport)

连续 3 次错误后，连接会被自动标记为不健康并触发重连。

## 5. 其他推荐实践

### 5.1 日志记录

建议 MCP 服务器记录：
- 所有请求的访问日志
- 错误和异常日志
- 健康检查调用日志

### 5.2 优雅关闭

支持优雅关闭（graceful shutdown）：
- 接收到关闭信号后，停止接受新连接
- 等待现有请求处理完成
- 超时后强制关闭

### 5.3 版本信息

建议在健康检查响应中包含版本信息：
```json
{
  "status": "healthy",
  "version": "1.2.3",
  "build_time": "2025-01-15T10:30:00Z"
}
```

## 6. 验证工具

可以使用以下命令验证 MCP 服务器的健康检查接口：

```bash
# 基本检查
curl -X GET http://localhost:18060/health

# 预期响应
# {"status": "healthy"}

# 检查响应时间
time curl -X GET http://localhost:18060/health
```

## 7. 常见问题

### Q: 如果我的 MCP 服务器 URL 是 `/mcp`，健康检查应该在哪里？

A: 健康检查接口应该在服务器根路径，例如：
- MCP 服务: `http://localhost:18060/mcp`
- 健康检查: `http://localhost:18060/health`

### Q: 健康检查需要认证吗？

A: 健康检查接口**不应该**需要认证，以便：
- 负载均衡器可以检查服务健康状态
- 监控系统可以收集健康指标
- 客户端可以快速验证服务可用性

### Q: 如果健康检查失败怎么办？

A: 系统会：
1. 记录警告日志
2. 标记连接为不健康
3. 自动尝试重新建立连接
4. 如果连续失败，会在一段时间后再次尝试

---

**文档版本**: 1.0.0  
**最后更新**: 2025-01-15

