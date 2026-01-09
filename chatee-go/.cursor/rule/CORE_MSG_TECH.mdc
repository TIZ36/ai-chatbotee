完整技术设计文档
一、系统架构概览
1.1 核心组件
text
1. DBC (DataBase Controller) - 数据控制层
2. UserAgent - 用户在线代理
3. AiAgentActor - AI代理执行器
4. Redis Pub/Sub - 实时消息总线
5. HBase - 主数据存储
6. RPC框架 - 组件间通信
1.2 数据流架构
text
┌─────────┐    ┌─────────┐    ┌─────────────┐
│ Client  │───▶│UserAgent│◀──▶│   DBC       │
└─────────┘    └─────────┘    └─────────────┘
                    │               │
                    ▼               ▼
              ┌─────────┐    ┌─────────────┐
              │Redis    │◀──▶│   HBase     │
              │Pub/Sub  │    │   Storage   │
              └─────────┘    └─────────────┘
                    │               │
                    ▼               ▼
              ┌─────────────────────────┐
              │    AiAgentActor         │
              │    Manager              │
              └─────────────────────────┘
二、核心数据结构设计
2.1 HBase 表结构
表1: threads_metadata (Thread元数据)
text
RowKey: thread_{thread_id}

列族: meta
  - owner_id: string           // 贴主ID
  - root_msg_id: string       // 根消息ID
  - title: string            // 可选标题
  - ai_agents: []string      // JSON数组，贴主添加的AI列表
  - settings: JSON           // Thread设置
  - created_at: int64        // 创建时间戳
  - status: string          // "active" | "closed" | "archived"

列族: stats
  - reply_count: int64       // 回复总数
  - participants: []string   // JSON数组，参与过回复的用户
  - last_msg_id: string      // 最后一条消息ID
  - last_active_at: int64    // 最后活跃时间
  - hot_score: float64       // 热度评分（可选）
表2: thread_messages (Thread消息)
text
RowKey: {thread_id}_{reverse_timestamp}_{msg_id}
    // reverse_timestamp = MAX_INT64 - timestamp

列族: msg
  - msg_id: string           // 消息唯一ID
  - author_id: string        // 作者ID
  - author_type: string      // "user" | "ai"
  - content_type: string     // "text" | "image" | "video" | "file"
  - raw_content: []byte      // 原始内容（可能加密）
  - compressed: bool         // 是否压缩
  - parent_msg_id: string    // 父消息ID，空表示根消息
  - mentions: []string       // JSON数组，@的用户/AI列表
  - depth: int32             // 回复深度（0:根消息）
  - metadata: JSON           // 扩展元数据
  - timestamp: int64         // 创建时间戳
  - deleted: bool           // 软删除标记
表3: user_follow_feeds (用户关注Feed收件箱)
text
RowKey: {user_id}_{reverse_timestamp}_{thread_id}_{msg_id}

列族: feed
  - thread_id: string        // 所属Thread ID
  - msg_id: string          // 消息ID
  - msg_type: string        // "root" | "reply"
  - author_id: string       // 作者ID
  - author_type: string     // "user" | "ai"
  - content_preview: string // 内容预览（前100字符）
  - flags: JSON            // 标记位
      {
        "is_root": bool,
        "has_mention": bool,
        "is_ai": bool,
        "requires_follow": bool
      }
  - timestamp: int64        // 接收时间
  - read: bool             // 已读标记
表4: user_rev_reply_feeds (用户回复收件箱)
text
RowKey: {user_id}_{reverse_timestamp}_{thread_id}_{reply_msg_id}

列族: reply
  - thread_id: string       // Thread ID
  - reply_msg_id: string    // 回复消息ID
  - reply_author: string    // 回复者ID
  - parent_msg_id: string   // 被回复的消息ID
  - push_type: string       // "full" | "limited" | "mention"
  - content_type: string    // "full_content" | "preview_only"
  - content_preview: string // 预览文本
  - full_content: []byte    // 完整内容（仅push_type=full时有）
  - reason: string         // "owner" | "mentioned" | "ai_mentioned"
  - timestamp: int64       // 接收时间
  - require_follow: bool   // 是否需要关注贴主
  - thread_owner: string   // Thread贴主ID
表5: chats_metadata (会话元数据)
text
RowKey: chat_{chat_key}
    // 私聊: max(uid1,uid2):min(uid1,uid2)
    // 群聊: group_{owner_id_base}_{id}

列族: meta
  - chat_type: string       // "private" | "group"
  - participants: []string  // JSON数组，所有参与者
  - ai_agents: []string     // JSON数组，会话中的AI
  - created_by: string      // 创建者ID
  - created_at: int64       // 创建时间
  - settings: JSON          // 会话设置
  - status: string         // "active" | "muted" | "archived"

列族: stats
  - msg_count: int64       // 消息总数
  - last_msg_id: string    // 最后消息ID
  - last_active_at: int64  // 最后活跃时间
  - unread_counts: JSON    // 各参与者未读数
表6: chat_user_inbox (用户Chat收件箱)
text
RowKey: {user_id}_{chat_key}_{reverse_timestamp}_{msg_id}

列族: msg
  - chat_key: string        // 会话Key
  - msg_id: string         // 消息ID
  - sender_id: string      // 发送者ID
  - sender_type: string    // "user" | "ai"
  - content_type: string   // "text" | "image" | "file"
  - raw_content: []byte    // 原始内容
  - mentions: []string     // JSON数组，@的参与者
  - flags: JSON           // 标记位
      {
        "is_sender": bool,
        "has_mention": bool,
        "is_group": bool,
        "read": bool
      }
  - timestamp: int64       // 接收时间
2.2 Redis 数据结构
String类型: 缓存和配置
text
// 消息缓存
msg_cache:{msg_id} = JSON序列化(raw_message)

// 用户关系缓存
user:{user_id}:following = Set<被关注用户ID>
user:{user_id}:followers = Set<粉丝用户ID>
user:{user_id}:friends = Set<好友用户ID>

// 权限缓存
access:{user_id}:thread:{thread_id} = "full" | "preview" | "denied"
access:{user_id}:chat:{chat_key} = "allowed" | "denied"

// AI状态
ai:{agent_id}:context:{thread_id} = JSON(上下文状态)
Sorted Set类型: 排行榜和时间线
text
// 用户参与Thread热度排序
user:{user_id}:threads:hot = {(thread_id, hot_score), ...}

// 用户未读消息计数
unread:{user_id}:total = count
unread:{user_id}:thread:{thread_id} = count
unread:{user_id}:chat:{chat_key} = count
Pub/Sub Channels
text
// Thread相关
channel:new_feed           // 新Feed发布
channel:thread_reply       // Thread回复
channel:new_mention        // 被@提醒

// Chat相关  
channel:chat_message       // Chat消息
channel:chat_activity      // Chat活动通知

// AI相关
channel:ai_activation      // AI激活请求
channel:ai_response        // AI回复
2.3 Go 结构体定义（内存中）
go
// 消息基类
type BaseMessage struct {
    MsgID       string    `json:"msg_id"`
    AuthorID    string    `json:"author_id"`
    AuthorType  string    `json:"author_type"` // "user" | "ai"
    ContentType string    `json:"content_type"`
    RawContent  []byte    `json:"raw_content"`
    Mentions    []string  `json:"mentions"`
    Timestamp   int64     `json:"timestamp"`
    Metadata    Metadata  `json:"metadata"`
}

// Thread消息
type ThreadMessage struct {
    BaseMessage
    ThreadID     string `json:"thread_id"`
    ParentMsgID  string `json:"parent_msg_id,omitempty"`
    Depth        int32  `json:"depth"`
    IsRoot       bool   `json:"is_root"`
}

// Chat消息
type ChatMessage struct {
    BaseMessage
    ChatKey      string `json:"chat_key"`
    ChatType     string `json:"chat_type"` // "private" | "group"
}

// 推送消息
type PushMessage struct {
    Type         string      `json:"type"` // "thread_root" | "thread_reply" | "chat_msg"
    MsgID        string      `json:"msg_id"`
    ThreadID     string      `json:"thread_id,omitempty"`
    ChatKey      string      `json:"chat_key,omitempty"`
    AuthorID     string      `json:"author_id"`
    Content      interface{} `json:"content"` // 根据type不同
    PushConfig   PushConfig  `json:"push_config"`
    Recipients   []string    `json:"recipients"`
}

type PushConfig struct {
    Priority     int    `json:"priority"` // 1-10，越高越优先
    ExpireAfter  int64  `json:"expire_after,omitempty"` // 过期时间
    NeedConfirm  bool   `json:"need_confirm"` // 是否需要确认
    Silent       bool   `json:"silent"`       // 是否静默推送
}

// AI上下文
type AIContext struct {
    AgentID      string           `json:"agent_id"`
    ThreadID     string           `json:"thread_id,omitempty"`
    ChatKey      string           `json:"chat_key,omitempty"`
    ContextType  string           `json:"context_type"` // "thread" | "chat"
    History      []BaseMessage    `json:"history"`      // 最近N条历史
    MemoryState  map[string]interface{} `json:"memory_state"`
    LastActive   int64            `json:"last_active"`
}
三、核心业务流程设计
3.1 Thread根消息发布流程
步骤1: 接收与验证
text
1. DBC接收客户端请求:
   - 贴主ID (owner_id)
   - 消息内容 (content)
   - 消息类型 (content_type)
   - 附加AI列表 (ai_agents)

2. 验证:
   - 贴主存在性检查
   - AI Agent有效性验证
   - 内容安全审核（异步）

3. 生成ID:
   - msg_id = snowflake生成
   - thread_id = "thread_" + base62(timestamp + owner_id + random)
步骤2: 数据持久化
text
1. 写入threads_metadata:
   - 创建新Thread记录
   - 设置owner_id, root_msg_id
   - 初始化stats: {reply_count:0, participants:[owner_id]}

2. 写入thread_messages:
   - type = "root", depth = 0
   - parent_msg_id = ""
   - 存储原始内容（可能压缩加密）

3. 写入消息缓存:
   - redis.setex("msg_cache:"+msg_id, 24h, raw_message)

4. 记录贴主自己的Thread:
   - redis.zadd("user:"+owner_id+":threads:hot", thread_id, timestamp)
步骤3: 写扩散到粉丝收件箱
text
1. 获取粉丝列表:
   - redis.smembers("user:"+owner_id+":followers")
   - 包含贴主添加的AI Agents

2. 批量写入user_follow_feeds:
   for each 粉丝/ai in followers ∪ ai_agents:
       row_key = fan_id + "_" + reverse_ts + "_" + thread_id + "_" + msg_id
       
       写入列:
       - thread_id, msg_id, author_id
       - content_preview: 截取前100字符
       - flags: {is_root:true, has_mention:false}
       - timestamp: 当前时间

3. 更新粉丝未读计数:
   for each 粉丝 in followers:
       redis.incr("unread:"+fan_id+":total")
       redis.incr("unread:"+fan_id+":thread:"+thread_id)
步骤4: 实时推送
text
1. 准备推送消息:
   push_msg := PushMessage{
       Type: "thread_root",
       MsgID: msg_id,
       ThreadID: thread_id,
       AuthorID: owner_id,
       Content: {
           preview: content_preview,
           thread_title: 可选标题,
           author_info: 作者信息
       },
       PushConfig: {
           Priority: 5,
           NeedConfirm: false,
           Silent: false
       },
       Recipients: followers + ai_agents
   }

2. Redis发布:
   - redis.publish("new_feed", json_encode(push_msg))

3. 在线UserAgent处理:
   - 订阅new_feed频道的UserAgent收到消息
   - 验证自己是否在Recipients中
   - 更新本地Feed缓存
   - WebSocket推送客户端
步骤5: AI Agent处理
text
1. ActorAgentMgr监听new_feed:
   - 解析push_msg，提取ai_agents列表

2. 对每个AI Agent:
   if agent_id in ai_agents:
       // 激活AI处理
       context := AIContext{
           AgentID: agent_id,
           ThreadID: thread_id,
           ContextType: "thread",
           History: [当前消息],
           MemoryState: 从存储加载
       }
       
       // RPC调用AiAgentActor
       go rpc.Call("AiAgentActor."+agent_id, "OnNewThread", context)
       
       // AI可能异步回复
步骤6: 离线处理
text
不在线用户:
1. 消息已存入user_follow_feeds表
2. 下次上线时，UserAgent会:
   - 查询HBase: scan user_follow_feeds with prefix {user_id}_
   - 按时间倒序获取未读消息
   - 批量拉取消息内容（从缓存或HBase）
   - 推送给客户端
3.2 Thread回复消息流程
步骤1: 权限验证
text
输入:
   - 回复者ID (replier_id)
   - Thread ID (thread_id)
   - 回复内容 (content)
   - 父消息ID (parent_msg_id)
   - @列表 (mentions)

验证链:
1. 回复者必须是贴主的粉丝:
   redis.sismember("user:"+thread_owner+":followers", replier_id)

2. @权限验证:
   for each mention in mentions:
       if is_user(mention):
           // 必须是回复者的好友（双向关注）
           if !redis.sismember("user:"+replier_id+":friends", mention):
               拒绝并返回错误
       else if is_ai(mention):
           // 必须是Thread中的AI
           if !in_slice(thread_metadata.ai_agents, mention):
               拒绝并返回错误
       else:
           拒绝无效@

3. 父消息存在性检查
步骤2: 数据持久化
text
1. 生成回复消息ID:
   reply_msg_id = snowflake生成

2. 写入thread_messages:
   - type = "reply"
   - parent_msg_id = 被回复的消息ID
   - depth = 父消息深度 + 1
   - mentions = 经过验证的@列表

3. 更新threads_metadata:
   - reply_count += 1
   - 如果回复者不在participants中，则添加
   - last_msg_id = reply_msg_id
   - last_active_at = now()
   - 可选：更新hot_score（基于回复频率）

4. 缓存消息:
   - redis.setex("msg_cache:"+reply_msg_id, 24h, reply_message)
步骤3: 推送目标计算
go
func CalculatePushTargets(reply_msg, thread_meta) (fullTargets, limitedTargets []string) {
    fullTargets = []string{}
    limitedTargets = []string{}
    
    // 1. 贴主必定收到完整推送
    fullTargets = append(fullTargets, thread_meta.OwnerID)
    
    // 2. 处理@提及
    for _, mention := range reply_msg.Mentions {
        if IsAI(mention) {
            // 被@的AI: 完整推送
            fullTargets = append(fullTargets, mention)
        } else if IsUser(mention) {
            // 被@的用户: 检查是否是贴主粉丝
            if IsFollowing(mention, thread_meta.OwnerID) {
                fullTargets = append(fullTargets, mention)
            } else {
                // 不是贴主粉丝 → 受限推送
                limitedTargets = append(limitedTargets, mention)
            }
        }
    }
    
    // 3. Thread中的其他AI（未被@）: 只更新记忆，不推送
    // 在后续步骤中异步处理
    
    return deduplicate(fullTargets), deduplicate(limitedTargets)
}
步骤4: 写扩散到回复收件箱
text
// 完整推送目标
for each target in fullTargets:
    row_key = target + "_" + reverse_ts + "_" + thread_id + "_" + reply_msg_id
    
    写入user_rev_reply_feeds:
    - push_type: "full"
    - content_type: "full_content"
    - full_content: 完整消息内容
    - reason: "owner" 或 "mentioned" 或 "ai_mentioned"
    - require_follow: false

// 受限推送目标  
for each target in limitedTargets:
    row_key = target + "_" + reverse_ts + "_" + thread_id + "_" + reply_msg_id
    
    写入user_rev_reply_feeds:
    - push_type: "limited"
    - content_type: "preview_only"
    - content_preview: "用户{replier}在{owner}的Thread中提到了你"
    - reason: "mentioned"
    - require_follow: true
    - thread_owner: thread_meta.OwnerID

// 更新未读计数
for each target in fullTargets ∪ limitedTargets:
    redis.incr("unread:"+target+":total")
    redis.incr("unread:"+target+":thread:"+thread_id)
步骤5: 实时推送
text
// 完整推送（RPC Cast）
for each online_user in fullTargets:
    if UserAgent.IsOnline(online_user):
        go rpc.Cast("UserAgent."+online_user, "OnThreadReply", {
            Type: "full_reply",
            ThreadID: thread_id,
            MsgID: reply_msg_id,
            Content: full_content,
            Author: replier_id,
            ParentMsgID: parent_msg_id
        })

// 受限推送（RPC Cast）
for each online_user in limitedTargets:
    if UserAgent.IsOnline(online_user):
        go rpc.Cast("UserAgent."+online_user, "OnThreadReply", {
            Type: "limited_mention",
            ThreadID: thread_id,
            MsgID: reply_msg_id,
            Preview: "用户{replier}在{owner}的Thread中提到了你",
            ThreadOwner: thread_meta.OwnerID,
            RequiresFollow: true
        })

// Redis发布事件
redis.publish("thread_reply", {
    thread_id: thread_id,
    reply_msg_id: reply_msg_id,
    author: replier_id,
    full_targets: fullTargets,
    limited_targets: limitedTargets
})
步骤6: AI处理
text
// 被@的AI处理
for each ai_target in fullTargets where IsAI(ai_target):
    // 准备AI上下文
    context := LoadAIContext(ai_target, thread_id)
    context.History = FetchThreadMessages(thread_id, last_n=50)
    
    // RPC激活AI
    go rpc.Call("AiAgentActor."+ai_target, "OnThreadReply", {
        Context: context,
        ReplyMsg: reply_msg,
        Trigger: "mention"  // 触发原因
    })

// 未被@的AI记忆更新（异步）
for each ai_agent in thread_meta.ai_agents:
    if ai_agent not in reply_msg.mentions:
        // 异步任务更新AI记忆
        go AsyncUpdateAIMemory(ai_agent, thread_id, reply_msg)
        
        // 更新AI上下文缓存
        redis.setex("ai:"+ai_agent+":context:"+thread_id, 
                    1h, 
                    updated_context)
步骤7: 客户端交互处理
text
受限用户点击提示时的流程:
1. 客户端收到limited_mention推送
2. 显示提示:"用户B在A的Thread中提到了你"
3. 用户点击查看:
   a) 客户端检查本地关注关系缓存
   b) 如果已关注A: 直接请求Thread详情
   c) 如果未关注A:
       显示提示框:"需要先关注用户A才能查看"
       提供关注按钮
       
4. 用户点击关注:
   a) 调用关注API
   b) 成功关注后，重新拉取Thread详情
   c) 显示完整内容
   
5. 服务端记录关注事件:
   更新user_rev_reply_feeds中对应记录的require_follow为false
3.3 Chat消息流程
步骤1: 消息发送验证
text
输入验证:
1. 发送者是否是会话参与者
   redis.sismember("chat:"+chat_key+":participants", sender_id)

2. @权限验证:
   for each mention in mentions:
       if !in_slice(chat_meta.participants, mention):
           拒绝无效@
   
3. 会话状态检查:
   if chat_meta.status == "muted" && sender不是管理员:
       拒绝发送
   if chat_meta.status == "archived":
       拒绝发送
步骤2: 写扩散到参与者收件箱
text
1. 生成消息ID:
   msg_id = snowflake生成

2. 对每个参与者P in chat_meta.participants:
   row_key = P + "_" + chat_key + "_" + reverse_ts + "_" + msg_id
   
   写入chat_user_inbox:
   - chat_key, msg_id, sender_id
   - raw_content: 消息内容
   - flags: {
        is_sender: (P == sender_id),
        has_mention: (P in mentions),
        is_group: (chat_meta.type == "group"),
        read: (P == sender_id) // 发送者标记为已读
     }
   - timestamp: now()

3. 更新未读计数（除发送者）:
   for each P in chat_meta.participants where P != sender_id:
       redis.incr("unread:"+P+":total")
       redis.hincrby("chat:"+chat_key+":unread", P, 1)
步骤3: 实时推送
text
// 准备推送消息
push_msg := PushMessage{
    Type: "chat_message",
    MsgID: msg_id,
    ChatKey: chat_key,
    AuthorID: sender_id,
    Content: {
        content: message_content,
        chat_type: chat_meta.type,
        is_group: chat_meta.type == "group"
    },
    PushConfig: {
        Priority: 8,  // Chat优先级较高
        NeedConfirm: true,  // 需要送达确认
        Silent: chat_meta.settings.muted
    },
    Recipients: chat_meta.participants except sender_id
}

// Redis发布
redis.publish("chat_message", json_encode(push_msg))

// 在线用户推送
for each recipient in push_msg.Recipients:
    if UserAgent.IsOnline(recipient):
        go rpc.Cast("UserAgent."+recipient, "OnChatMessage", {
            ChatKey: chat_key,
            MsgID: msg_id,
            Sender: sender_id,
            Content: message_content,
            Mentions: mentions,
            Timestamp: timestamp
        })
步骤4: AI处理
text
// 被@的AI处理
for each ai_agent in mentions where IsAI(ai_agent):
    context := LoadAIContext(ai_agent, chat_key)
    context.History = FetchChatMessages(chat_key, last_n=100)
    
    go rpc.Call("AiAgentActor."+ai_agent, "OnChatMessage", {
        Context: context,
        Message: chat_message,
        Trigger: "mention"
    })

// 未被@的AI记忆更新
for each ai_agent in chat_meta.ai_agents:
    if ai_agent not in mentions:
        go AsyncUpdateAIMemory(ai_agent, chat_key, chat_message)
步骤5: 更新会话元数据
text
// 更新chats_metadata
1. msg_count += 1
2. last_msg_id = msg_id
3. last_active_at = now()
4. 更新last_sender = sender_id

// 更新参与者最后阅读位置（可选）
for each participant in chat_meta.participants:
    if participant != sender_id:
        // 记录未读位置
        redis.hset("chat:"+chat_key+":read_pos", 
                   participant, 
                   last_msg_id_before)
四、性能优化设计
4.1 批量操作优化
text
1. HBase批量写入:
   - 粉丝数>100时，使用HBase的Batch Put
   - 按Region Server分组批量提交
   - 设置合适的WriteBufferSize

2. Redis管道操作:
   - 多个粉丝的未读计数更新使用pipeline
   - 批量获取在线状态使用mget

3. 内存缓存策略:
   - 热点Thread元数据缓存
   - 用户关系缓存（带TTL）
   - 消息内容LRU缓存
4.2 异步处理设计
text
1. 非关键路径异步化:
   - AI记忆更新 → 消息队列
   - 消息索引构建 → 后台任务
   - 数据统计聚合 → 定时任务

2. 优先级队列:
   - 高: 实时推送消息
   - 中: AI处理请求
   - 低: 数据同步、备份

3. 延迟写扩散:
   - 对于超大粉丝数（>10万）的Thread
   - 先推送给活跃粉丝
   - 其他粉丝异步写入
4.3 监控与告警
text
关键指标监控:
1. 消息处理延迟: P50 < 50ms, P99 < 200ms
2. 写扩散成功率: > 99.9%
3. 在线推送成功率: > 99%
4. HBase读写延迟
5. Redis内存使用率

告警规则:
1. 消息堆积 > 1000
2. 写扩散失败率 > 1%
3. 在线用户推送失败率 > 5%
4. AI处理超时 > 30s
五、容错与一致性
5.1 消息投递保证
text
至少一次投递:
1. 写入HBase成功后才推送
2. RPC Cast失败重试（最多3次）
3. 离线消息持久化存储
4. 客户端确认机制

顺序保证:
1. Thread内消息严格按时间顺序
2. Chat内消息按发送顺序
3. 使用单调递增消息ID
5.2 故障恢复
text
1. DBC故障:
   - 无状态设计，可快速重启
   - 消息处理幂等性
   - 检查点恢复未完成操作

2. HBase故障:
   - 读写降级到备用集群
   - 重要数据双写
   - 缓存层兜底

3. Redis故障:
   - 推送降级为拉取模式
   - 关系数据回源数据库查询
   - 会话状态临时内存存储
5.3 数据一致性策略
text
最终一致性保证:
1. 写扩散失败补偿:
   - 记录失败粉丝列表
   - 定时任务重试
   - 用户下次上线时补偿

2. 计数一致性:
   - 使用HBase原子操作
   - 定期全量校正
   - 缓存与数据库同步

3. 关系数据同步:
   - Redis缓存TTL + 主动失效
   - 数据库变更事件通知
   - 客户端长轮询更新
这个完整设计涵盖了所有技术细节，包括数据结构、业务流程、性能优化和容错机制，可以指导具体的实现工作。

