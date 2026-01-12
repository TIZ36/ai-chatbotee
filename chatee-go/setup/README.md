# 本地开发环境设置

本目录包含用于本地开发的 Docker Compose 配置，用于启动所有必需的基础设施服务。

## 目录结构

```
setup/
├── redis/                    # Redis 独立启动
│   ├── docker-compose.yaml
│   ├── start.sh
│   └── stop.sh
├── mysql/                    # MySQL 独立启动
│   ├── docker-compose.yaml
│   ├── init/
│   │   └── 001_schema.sql
│   ├── start.sh
│   └── stop.sh
├── hbase/                    # HBase 独立启动 (带 Thrift)
│   ├── docker-compose.yaml
│   ├── start-thrift.sh
│   ├── start.sh
│   ├── stop.sh
│   └── init-tables.sh
├── docker-compose.yaml       # 一键启动所有服务
└── README.md
```

## 独立启动（推荐开发时使用）

### Redis
```bash
cd setup/redis
./start.sh

# 连接信息
# Host: localhost:6379
# Password: chatee_redis
```

### MySQL
```bash
cd setup/mysql
./start.sh

# 连接信息
# Host: localhost:3306
# Root Password: chatee_root
# Database: chatee
# User: chatee / chatee_pass
```

### HBase (带 Thrift)
```bash
cd setup/hbase
./start.sh

# 等待启动完成后初始化表
./init-tables.sh

# 连接信息
# ZooKeeper: localhost:2181
# Thrift:    localhost:9090
# Thrift2:   localhost:9095 (推荐)
# Web UI:    http://localhost:16010
```

### 停止服务
```bash
cd setup/redis && ./stop.sh
cd setup/mysql && ./stop.sh
cd setup/hbase && ./stop.sh
```

---

## 一键启动所有服务

### 启动

```bash
cd setup
docker-compose up -d
```

### 检查服务状态

```bash
docker-compose ps
```

### 查看服务日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f mysql
docker-compose logs -f redis
docker-compose logs -f hbase
docker-compose logs -f chromadb
```

### 停止所有服务

```bash
docker-compose down
```

### 停止并删除数据卷（清理数据）

```bash
docker-compose down -v
```

## 服务访问信息

### MySQL
- Host: localhost
- Port: 3306
- Database: chatee
- User: chatee
- Password: chatee_pass (默认，可通过环境变量修改)

### Redis
- Host: localhost
- Port: 6379
- Password: chatee_redis (默认，可通过环境变量修改)

### HBase
- Master Web UI: http://localhost:16010
- RegionServer Web UI: http://localhost:16020
- Master RPC: localhost:16000
- RegionServer RPC: localhost:16030

### ChromaDB
- API Endpoint: http://localhost:8000
- Health Check: http://localhost:8000/api/v1/heartbeat

## 环境变量

创建 `.env` 文件来自定义配置：

```env
MYSQL_ROOT_PASSWORD=your_root_password
MYSQL_PASSWORD=your_mysql_password
REDIS_PASSWORD=your_redis_password
```

## 初始化数据库

MySQL 数据库会在首次启动时自动执行 `../deployments/docker/init/mysql/` 目录下的 SQL 脚本。

## 注意事项

1. **HBase 启动较慢**: HBase 需要一些时间来初始化，首次启动可能需要 1-2 分钟
2. **端口冲突**: 确保本地没有其他服务占用上述端口
3. **数据持久化**: 所有数据都存储在 Docker volumes 中，删除容器不会丢失数据（除非使用 `-v` 参数）

## 故障排查

### HBase 无法启动
- 检查端口是否被占用
- 查看日志: `docker-compose logs hbase`
- 增加启动等待时间（修改 healthcheck 的 start_period）

### ChromaDB 连接失败
- 检查端口 8000 是否可访问
- 验证健康检查: `curl http://localhost:8000/api/v1/heartbeat`

### MySQL 连接问题
- 确认容器已完全启动: `docker-compose ps`
- 检查日志: `docker-compose logs mysql`
