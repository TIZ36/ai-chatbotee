package handler

import (
	"context"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	dbc "chatee-go/gen/dbc"
	"github.com/redis/go-redis/v9"
)

// CacheHandler implements CacheService gRPC interface
type CacheHandler struct {
	dbc.UnimplementedCacheServiceServer
	
	redis  *redis.Client
	logger log.Logger
}

// NewCacheHandler creates a new cache handler
func NewCacheHandler(redis *redis.Client, logger log.Logger) *CacheHandler {
	return &CacheHandler{
		redis:  redis,
		logger: logger,
	}
}

// Register registers the handler with gRPC server
func (h *CacheHandler) Register(server *grpc.Server) {
	dbc.RegisterCacheServiceServer(server, h)
}

// String operations

func (h *CacheHandler) Get(ctx context.Context, req *dbc.GetRequest) (*dbc.GetResponse, error) {
	val, err := h.redis.Get(ctx, req.GetKey()).Result()
	if err == redis.Nil {
		return &dbc.GetResponse{Exists: false}, nil
	}
	if err != nil {
		h.logger.Error("Failed to get from cache", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get: %v", err)
	}
	return &dbc.GetResponse{Value: val, Exists: true}, nil
}

func (h *CacheHandler) Set(ctx context.Context, req *dbc.SetRequest) (*dbc.SetResponse, error) {
	ttl := time.Duration(req.GetTtlSeconds()) * time.Second
	if req.GetTtlSeconds() == 0 {
		ttl = 0 // No expiration
	}
	
	err := h.redis.Set(ctx, req.GetKey(), req.GetValue(), ttl).Err()
	if err != nil {
		h.logger.Error("Failed to set cache", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to set: %v", err)
	}
	return &dbc.SetResponse{Success: true}, nil
}

func (h *CacheHandler) Delete(ctx context.Context, req *dbc.DeleteRequest) (*dbc.DeleteResponse, error) {
	err := h.redis.Del(ctx, req.GetKey()).Err()
	if err != nil {
		h.logger.Error("Failed to delete from cache", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete: %v", err)
	}
	return &dbc.DeleteResponse{Success: true}, nil
}

func (h *CacheHandler) Exists(ctx context.Context, req *dbc.ExistsRequest) (*dbc.ExistsResponse, error) {
	count, err := h.redis.Exists(ctx, req.GetKey()).Result()
	if err != nil {
		h.logger.Error("Failed to check existence", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to check existence: %v", err)
	}
	return &dbc.ExistsResponse{Exists: count > 0}, nil
}

func (h *CacheHandler) Expire(ctx context.Context, req *dbc.ExpireRequest) (*dbc.ExpireResponse, error) {
	ok, err := h.redis.Expire(ctx, req.GetKey(), time.Duration(req.GetSeconds())*time.Second).Result()
	if err != nil {
		h.logger.Error("Failed to set expiration", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to set expiration: %v", err)
	}
	return &dbc.ExpireResponse{Success: ok}, nil
}

// Set operations

func (h *CacheHandler) SAdd(ctx context.Context, req *dbc.SAddRequest) (*dbc.SAddResponse, error) {
	count, err := h.redis.SAdd(ctx, req.GetKey(), req.GetMembers()).Result()
	if err != nil {
		h.logger.Error("Failed to add set members", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to add set members: %v", err)
	}
	return &dbc.SAddResponse{AddedCount: count}, nil
}

func (h *CacheHandler) SRem(ctx context.Context, req *dbc.SRemRequest) (*dbc.SRemResponse, error) {
	count, err := h.redis.SRem(ctx, req.GetKey(), req.GetMembers()).Result()
	if err != nil {
		h.logger.Error("Failed to remove set members", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to remove set members: %v", err)
	}
	return &dbc.SRemResponse{RemovedCount: count}, nil
}

func (h *CacheHandler) SMembers(ctx context.Context, req *dbc.SMembersRequest) (*dbc.SMembersResponse, error) {
	members, err := h.redis.SMembers(ctx, req.GetKey()).Result()
	if err != nil {
		h.logger.Error("Failed to get set members", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get set members: %v", err)
	}
	return &dbc.SMembersResponse{Members: members}, nil
}

func (h *CacheHandler) SIsMember(ctx context.Context, req *dbc.SIsMemberRequest) (*dbc.SIsMemberResponse, error) {
	isMember, err := h.redis.SIsMember(ctx, req.GetKey(), req.GetMember()).Result()
	if err != nil {
		h.logger.Error("Failed to check set membership", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to check set membership: %v", err)
	}
	return &dbc.SIsMemberResponse{IsMember: isMember}, nil
}

func (h *CacheHandler) SCard(ctx context.Context, req *dbc.SCardRequest) (*dbc.SCardResponse, error) {
	count, err := h.redis.SCard(ctx, req.GetKey()).Result()
	if err != nil {
		h.logger.Error("Failed to get set cardinality", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get set cardinality: %v", err)
	}
	return &dbc.SCardResponse{Count: count}, nil
}

// Sorted Set operations

func (h *CacheHandler) ZAdd(ctx context.Context, req *dbc.ZAddRequest) (*dbc.ZAddResponse, error) {
	var members []redis.Z
	for _, m := range req.GetMembers() {
		members = append(members, redis.Z{
			Score:  m.GetScore(),
			Member: m.GetMember(),
		})
	}
	count, err := h.redis.ZAdd(ctx, req.GetKey(), members...).Result()
	if err != nil {
		h.logger.Error("Failed to add sorted set members", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to add sorted set members: %v", err)
	}
	return &dbc.ZAddResponse{AddedCount: count}, nil
}

func (h *CacheHandler) ZRem(ctx context.Context, req *dbc.ZRemRequest) (*dbc.ZRemResponse, error) {
	count, err := h.redis.ZRem(ctx, req.GetKey(), req.GetMembers()).Result()
	if err != nil {
		h.logger.Error("Failed to remove sorted set members", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to remove sorted set members: %v", err)
	}
	return &dbc.ZRemResponse{RemovedCount: count}, nil
}

func (h *CacheHandler) ZRange(ctx context.Context, req *dbc.ZRangeRequest) (*dbc.ZRangeResponse, error) {
	members, err := h.redis.ZRange(ctx, req.GetKey(), req.GetStart(), req.GetStop()).Result()
	if err != nil {
		h.logger.Error("Failed to get sorted set range", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get sorted set range: %v", err)
	}
	return &dbc.ZRangeResponse{Members: members}, nil
}

func (h *CacheHandler) ZRevRange(ctx context.Context, req *dbc.ZRevRangeRequest) (*dbc.ZRevRangeResponse, error) {
	members, err := h.redis.ZRevRange(ctx, req.GetKey(), req.GetStart(), req.GetStop()).Result()
	if err != nil {
		h.logger.Error("Failed to get sorted set reverse range", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get sorted set reverse range: %v", err)
	}
	return &dbc.ZRevRangeResponse{Members: members}, nil
}

func (h *CacheHandler) ZScore(ctx context.Context, req *dbc.ZScoreRequest) (*dbc.ZScoreResponse, error) {
	score, err := h.redis.ZScore(ctx, req.GetKey(), req.GetMember()).Result()
	if err == redis.Nil {
		return &dbc.ZScoreResponse{Exists: false}, nil
	}
	if err != nil {
		h.logger.Error("Failed to get sorted set score", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get sorted set score: %v", err)
	}
	return &dbc.ZScoreResponse{Score: score, Exists: true}, nil
}

func (h *CacheHandler) ZIncrBy(ctx context.Context, req *dbc.ZIncrByRequest) (*dbc.ZIncrByResponse, error) {
	newScore, err := h.redis.ZIncrBy(ctx, req.GetKey(), req.GetIncrement(), req.GetMember()).Result()
	if err != nil {
		h.logger.Error("Failed to increment sorted set score", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to increment sorted set score: %v", err)
	}
	return &dbc.ZIncrByResponse{NewScore: newScore}, nil
}

// Hash operations

func (h *CacheHandler) HGet(ctx context.Context, req *dbc.HGetRequest) (*dbc.HGetResponse, error) {
	val, err := h.redis.HGet(ctx, req.GetKey(), req.GetField()).Result()
	if err == redis.Nil {
		return &dbc.HGetResponse{Exists: false}, nil
	}
	if err != nil {
		h.logger.Error("Failed to get hash field", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get hash field: %v", err)
	}
	return &dbc.HGetResponse{Value: val, Exists: true}, nil
}

func (h *CacheHandler) HSet(ctx context.Context, req *dbc.HSetRequest) (*dbc.HSetResponse, error) {
	count, err := h.redis.HSet(ctx, req.GetKey(), req.GetField(), req.GetValue()).Result()
	if err != nil {
		h.logger.Error("Failed to set hash field", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to set hash field: %v", err)
	}
	return &dbc.HSetResponse{Success: count > 0}, nil
}

func (h *CacheHandler) HGetAll(ctx context.Context, req *dbc.HGetAllRequest) (*dbc.HGetAllResponse, error) {
	fields, err := h.redis.HGetAll(ctx, req.GetKey()).Result()
	if err != nil {
		h.logger.Error("Failed to get all hash fields", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get all hash fields: %v", err)
	}
	return &dbc.HGetAllResponse{Fields: fields}, nil
}

func (h *CacheHandler) HIncrBy(ctx context.Context, req *dbc.HIncrByRequest) (*dbc.HIncrByResponse, error) {
	newVal, err := h.redis.HIncrBy(ctx, req.GetKey(), req.GetField(), req.GetIncrement()).Result()
	if err != nil {
		h.logger.Error("Failed to increment hash field", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to increment hash field: %v", err)
	}
	return &dbc.HIncrByResponse{NewValue: newVal}, nil
}

func (h *CacheHandler) HDel(ctx context.Context, req *dbc.HDelRequest) (*dbc.HDelResponse, error) {
	count, err := h.redis.HDel(ctx, req.GetKey(), req.GetFields()...).Result()
	if err != nil {
		h.logger.Error("Failed to delete hash fields", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete hash fields: %v", err)
	}
	return &dbc.HDelResponse{DeletedCount: count}, nil
}

// Counter operations

func (h *CacheHandler) Incr(ctx context.Context, req *dbc.IncrRequest) (*dbc.IncrResponse, error) {
	val, err := h.redis.Incr(ctx, req.GetKey()).Result()
	if err != nil {
		h.logger.Error("Failed to increment", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to increment: %v", err)
	}
	return &dbc.IncrResponse{Value: val}, nil
}

func (h *CacheHandler) Decr(ctx context.Context, req *dbc.DecrRequest) (*dbc.DecrResponse, error) {
	val, err := h.redis.Decr(ctx, req.GetKey()).Result()
	if err != nil {
		h.logger.Error("Failed to decrement", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to decrement: %v", err)
	}
	return &dbc.DecrResponse{Value: val}, nil
}

func (h *CacheHandler) IncrBy(ctx context.Context, req *dbc.IncrByRequest) (*dbc.IncrByResponse, error) {
	val, err := h.redis.IncrBy(ctx, req.GetKey(), req.GetIncrement()).Result()
	if err != nil {
		h.logger.Error("Failed to increment by", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to increment by: %v", err)
	}
	return &dbc.IncrByResponse{Value: val}, nil
}

func (h *CacheHandler) DecrBy(ctx context.Context, req *dbc.DecrByRequest) (*dbc.DecrByResponse, error) {
	val, err := h.redis.DecrBy(ctx, req.GetKey(), req.GetDecrement()).Result()
	if err != nil {
		h.logger.Error("Failed to decrement by", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to decrement by: %v", err)
	}
	return &dbc.DecrByResponse{Value: val}, nil
}

// Pub/Sub operations

func (h *CacheHandler) Publish(ctx context.Context, req *dbc.PublishRequest) (*dbc.PublishResponse, error) {
	count, err := h.redis.Publish(ctx, req.GetChannel(), req.GetMessage()).Result()
	if err != nil {
		h.logger.Error("Failed to publish", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to publish: %v", err)
	}
	return &dbc.PublishResponse{SubscriberCount: count}, nil
}

// Batch operations

func (h *CacheHandler) MGet(ctx context.Context, req *dbc.MGetRequest) (*dbc.MGetResponse, error) {
	vals, err := h.redis.MGet(ctx, req.GetKeys()...).Result()
	if err != nil {
		h.logger.Error("Failed to get multiple keys", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get multiple keys: %v", err)
	}
	
	// Convert to map[string]string format
	values := make(map[string]string)
	for i, val := range vals {
		if val != nil {
			values[req.GetKeys()[i]] = val.(string)
		}
	}
	return &dbc.MGetResponse{Values: values}, nil
}

func (h *CacheHandler) MSet(ctx context.Context, req *dbc.MSetRequest) (*dbc.MSetResponse, error) {
	pairs := make([]interface{}, 0, len(req.GetKeyValues())*2)
	for key, value := range req.GetKeyValues() {
		pairs = append(pairs, key, value)
	}
	err := h.redis.MSet(ctx, pairs...).Err()
	if err != nil {
		h.logger.Error("Failed to set multiple keys", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to set multiple keys: %v", err)
	}
	return &dbc.MSetResponse{Success: true}, nil
}

