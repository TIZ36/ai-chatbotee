# Nginx 反向代理配置指南

## 问题分析

当前架构中，局域网访问时：
- 前端运行在 `0.0.0.0:5177`
- 后端运行在 `0.0.0.0:3002`
- 前端通过 `getBackendUrl()` 动态获取后端地址（`http://<hostname>:3002`）

**性能问题可能的原因：**
1. **跨端口请求**：浏览器从 5177 端口请求 3002 端口，可能受到浏览器限制
2. **缺少 HTTP/2 和压缩**：直接访问 Flask 没有这些优化
3. **网络延迟**：跨端口请求可能增加延迟

## 解决方案：使用 Nginx 反向代理

使用 Nginx 反向代理可以：
- ✅ 统一端口（前端和后端都通过 80/443 访问）
- ✅ 启用 HTTP/2 和 gzip 压缩
- ✅ 更好的性能（Nginx 处理静态文件）
- ✅ 更好的安全性（可以添加 SSL）

## 配置步骤

### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 2. 配置 Nginx

将 `nginx.conf.example` 复制到 Nginx 配置目录：

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/ai-chatbotee
sudo ln -s /etc/nginx/sites-available/ai-chatbotee /etc/nginx/sites-enabled/
```

### 3. 修改配置（可选）

编辑 `/etc/nginx/sites-available/ai-chatbotee`，修改 `server_name`：

```nginx
server_name your-domain.com;  # 或使用你的 IP 地址
```

### 4. 测试并重载配置

```bash
# 测试配置
sudo nginx -t

# 重载配置
sudo systemctl reload nginx
```

### 5. 配置前端使用相对路径

在 `.env` 文件中设置：

```bash
# 使用反向代理时，使用相对路径
VITE_BACKEND_URL=
```

或者在前端构建时：

```bash
VITE_BACKEND_URL= npm run build
```

### 6. 访问

- 通过 Nginx：`http://your-server-ip/` 或 `http://your-domain.com/`
- 前端会自动使用相对路径请求后端（`/api/...`）
- Nginx 会将 `/api/` 转发到 `http://localhost:3002/api/`

## 性能优化建议

### 1. 启用 HTTP/2（需要 SSL）

```nginx
listen 443 ssl http2;
ssl_certificate /path/to/cert.pem;
ssl_certificate_key /path/to/key.pem;
```

### 2. 调整缓冲区大小

```nginx
client_max_body_size 100M;  # 支持大文件上传
proxy_buffer_size 128k;
proxy_buffers 4 256k;
```

### 3. 启用缓存（生产环境）

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 不使用反向代理的优化

如果不想使用 Nginx，可以：

1. **确保后端监听在 0.0.0.0**（已完成）
2. **优化数据库查询**（已完成）
3. **减少数据传输**（已完成，移除了 system_prompt）
4. **使用 HTTP/2**：需要 Flask 支持或使用其他 WSGI 服务器（如 Gunicorn + uWSGI）

## 验证

访问 `http://your-server-ip/`，检查：
- 前端正常加载
- API 请求正常（检查浏览器 Network 面板）
- 响应时间是否改善

