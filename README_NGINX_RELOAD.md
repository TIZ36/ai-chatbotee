# Nginx 配置重载指南

## 快速重载

### 方法 1：使用脚本（推荐）

```bash
sudo ./reload_nginx.sh
```

### 方法 2：使用 systemctl（推荐）

```bash
# 测试配置
sudo nginx -t

# 重载配置（不中断服务）
sudo systemctl reload nginx
```

### 方法 3：使用 nginx 命令

```bash
# 测试配置
sudo nginx -t

# 重载配置（不中断服务）
sudo nginx -s reload
```

### 方法 4：重启服务（会短暂中断）

```bash
sudo systemctl restart nginx
```

## 命令说明

### 测试配置
```bash
sudo nginx -t
```
- 只测试配置，不重载
- 如果配置有错误，会显示错误信息
- 不会影响正在运行的服务

### 重载配置（推荐）
```bash
sudo systemctl reload nginx
# 或
sudo nginx -s reload
```
- **不中断服务**：正在处理的请求会继续完成
- **零停机**：新配置会平滑应用
- **推荐使用**：修改配置后使用此方法

### 重启服务
```bash
sudo systemctl restart nginx
```
- **会中断服务**：所有连接会断开
- **完全重启**：适用于配置测试失败后的恢复
- **不推荐**：除非重载失败

## 常见问题

### 1. 配置测试失败

如果 `nginx -t` 失败，检查：
- 配置文件语法错误
- 文件路径错误
- 权限问题

查看详细错误：
```bash
sudo nginx -t
```

查看错误日志：
```bash
sudo tail -f /var/log/nginx/error.log
```

### 2. 重载失败

如果重载失败，尝试：
```bash
# 检查 Nginx 状态
sudo systemctl status nginx

# 查看错误日志
sudo journalctl -u nginx -n 50

# 重启服务
sudo systemctl restart nginx
```

### 3. 检查配置是否生效

```bash
# 查看 Nginx 版本和配置路径
sudo nginx -V

# 查看运行状态
sudo systemctl status nginx

# 测试访问
curl -I http://localhost/
```

## 配置文件位置

- 主配置：`/etc/nginx/nginx.conf`
- 站点配置：`/etc/nginx/sites-available/ai-chatbotee`
- 启用配置：`/etc/nginx/sites-enabled/ai-chatbotee`

## 修改配置后的流程

1. **编辑配置文件**
   ```bash
   sudo nano /etc/nginx/sites-available/ai-chatbotee
   ```

2. **测试配置**
   ```bash
   sudo nginx -t
   ```

3. **重载配置**
   ```bash
   sudo systemctl reload nginx
   ```

4. **验证**
   ```bash
   curl -I http://localhost/
   ```

