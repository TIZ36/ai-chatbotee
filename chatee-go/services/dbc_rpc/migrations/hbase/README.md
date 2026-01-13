# HBase Migration Scripts

这个目录包含 HBase 数据库初始化脚本，用于创建 namespace 和表结构。

## 配置

脚本会自动读取 `dbc_rpc/config/config.yaml` 中的 HBase 配置：

```yaml
hbase:
  host: localhost:9095
  namespace: chatee
  client_type: 1
```

## 使用方法

### 1. 创建 Namespace

首先创建 HBase namespace：

```bash
cd services/dbc_rpc/migrations/hbase
./create_namespace.sh
```

这个脚本会：
- 读取配置文件中的 namespace 名称
- 连接本地 Docker HBase 容器
- 创建 namespace（如果不存在）
- 列出所有 namespace 进行验证

### 2. 创建表

然后创建所有需要的表：

```bash
./create_tables.sh
```

这个脚本会在配置的 namespace 下创建以下表：

**Thread 相关表：**
- `chatee:chatee_threads_metadata` - 线程元数据（列族：meta）
- `chatee:chatee_threads_messages` - 线程消息（列族：msg）
- `chatee:chatee_follow_feed` - 关注 Feed（列族：feed）
- `chatee:chatee_reply_feed` - 回复 Feed（列族：feed）

**Chat 相关表：**
- `chatee:chatee_chats_metadata` - 聊天元数据（列族：meta）
- `chatee:chatee_chats_inbox` - 聊天收件箱（列族：inbox）

## 前置条件

1. **HBase 容器运行中**
   ```bash
   docker ps | grep hbase
   ```

2. **yq 工具**（可选，用于解析 YAML）
   ```bash
   brew install yq
   ```
   如果没有安装 yq，脚本会使用默认值。

## 验证

创建完成后，可以进入 HBase shell 验证：

```bash
docker exec -it <hbase_container> hbase shell
```

在 HBase shell 中：
```ruby
# 查看所有 namespace
list_namespace

# 查看 chatee namespace 中的表
list_namespace_tables 'chatee'

# 查看表结构
describe 'chatee:chatee_threads_metadata'
```

## 故障排查

**HBase 容器未运行：**
```bash
cd setup/hbase
./start.sh
```

**Namespace 已存在：**
脚本会自动跳过，不会报错。

**表已存在：**
使用 `create_if_not_exists` 命令，安全幂等。
