# DBC (DataBase Controller) Protocol

## 概述

`dbc.proto` 定义了 DBC 服务提供的所有 gRPC 接口，用于统一的数据访问层。DBC 作为业务系统的数据中心，提供：

1. **MySQL 数据访问** - 用户、会话、Agent、消息、LLM配置、MCP服务器
2. **HBase 数据访问** - Thread和Chat的写扩散数据（收件箱）
3. **Redis 缓存操作** - 用户关系、未读计数、消息缓存、Pub/Sub

## 服务列表

### MySQL 数据服务

- **UserService** - 用户数据管理
- **SessionService** - 会话数据管理
- **AgentService** - AI Agent配置管理
- **MessageService** - 消息数据管理
- **LLMConfigService** - LLM配置管理
- **MCPServerService** - MCP服务器配置管理

### HBase 数据服务

- **HBaseThreadService** - Thread元数据、消息、收件箱（写扩散）
- **HBaseChatService** - Chat元数据、收件箱（写扩散）

### Redis 缓存服务

- **CacheService** - 完整的Redis操作接口
  - String操作（Get/Set/Delete）
  - Set操作（用户关系：关注/粉丝/好友）
  - Sorted Set操作（时间线、排行榜）
  - Hash操作（未读计数等）
  - Counter操作（未读数增减）
  - Pub/Sub操作（实时推送）

## 使用示例

### Go 客户端

```go
import (
    pb "chatee-go/proto/dbc"
    "google.golang.org/grpc"
)

// 连接DBC服务
conn, _ := grpc.Dial("localhost:9091", grpc.WithInsecure())
defer conn.Close()

// 使用UserService
userClient := pb.NewUserServiceClient(conn)
user, _ := userClient.GetUser(ctx, &pb.GetUserRequest{Id: "user123"})

// 使用CacheService
cacheClient := pb.NewCacheServiceClient(conn)
// 获取用户关注列表
followers, _ := cacheClient.SMembers(ctx, &pb.SMembersRequest{
    Key: "user:user123:followers",
})

// 使用HBaseThreadService
hbaseClient := pb.NewHBaseThreadServiceClient(conn)
// 保存Thread元数据
_, _ = hbaseClient.SaveThreadMetadata(ctx, &pb.SaveThreadMetadataRequest{
    Thread: &pb.ThreadMetadata{
        ThreadId: "thread_abc",
        OwnerId:  "user123",
        RootMsgId: "msg_xyz",
        Status:   "active",
    },
})
```

### 典型使用场景

#### 1. 获取用户信息并检查缓存

```go
// 先查缓存
cacheClient := pb.NewCacheServiceClient(conn)
cached, _ := cacheClient.Get(ctx, &pb.GetRequest{
    Key: "user:user123",
})

if cached.Exists {
    // 使用缓存数据
} else {
    // 查数据库
    userClient := pb.NewUserServiceClient(conn)
    user, _ := userClient.GetUser(ctx, &pb.GetUserRequest{Id: "user123"})
    // 写入缓存
    cacheClient.Set(ctx, &pb.SetRequest{
        Key:   "user:user123",
        Value: json.Marshal(user),
        TtlSeconds: 300,
    })
}
```

#### 2. 写扩散到粉丝收件箱

```go
hbaseClient := pb.NewHBaseThreadServiceClient(conn)

// 获取粉丝列表
cacheClient := pb.NewCacheServiceClient(conn)
followers, _ := cacheClient.SMembers(ctx, &pb.SMembersRequest{
    Key: "user:owner123:followers",
})

// 批量写入收件箱
for _, fanID := range followers.Members {
    feed := &pb.FollowFeedRow{
        UserId:        fanID,
        ThreadId:      threadID,
        MsgId:         msgID,
        MsgType:       "root",
        AuthorId:      ownerID,
        ContentPreview: preview,
        Timestamp:     time.Now().Unix(),
    }
    hbaseClient.SaveFollowFeed(ctx, &pb.SaveFollowFeedRequest{Feed: feed})
}
```

#### 3. 更新未读计数

```go
cacheClient := pb.NewCacheServiceClient(conn)

// 增加总未读数
cacheClient.Incr(ctx, &pb.IncrRequest{
    Key: "unread:user123:total",
})

// 增加Thread未读数
cacheClient.Incr(ctx, &pb.IncrRequest{
    Key: "unread:user123:thread:thread_abc",
})
```

## 注意事项

1. **连接池管理**: DBC服务内部管理MySQL、Redis、HBase连接池，客户端无需关心
2. **事务支持**: 对于需要事务的操作，DBC内部处理，客户端调用是原子的
3. **缓存一致性**: DBC负责维护缓存与数据库的一致性
4. **批量操作**: 对于大量数据操作，考虑使用批量接口或异步处理
5. **错误处理**: 所有服务都返回标准错误，客户端应检查错误码

## 性能优化

1. **缓存优先**: 优先使用CacheService查询热点数据
2. **批量操作**: 使用MGet、MSet等批量接口减少网络往返
3. **连接复用**: 使用gRPC连接池，复用连接
4. **异步调用**: 对于非关键路径，使用异步调用
