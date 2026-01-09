package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// =============================================================================
// Redis Repository
// =============================================================================

// RedisRepository provides Redis cache operations
type RedisRepository interface {
	// String operations
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error
	Delete(ctx context.Context, keys ...string) error
	Exists(ctx context.Context, key string) (bool, error)
	Expire(ctx context.Context, key string, expiration time.Duration) error

	// Hash operations
	HGet(ctx context.Context, key, field string) (string, error)
	HSet(ctx context.Context, key string, values ...interface{}) error
	HGetAll(ctx context.Context, key string) (map[string]string, error)
	HDel(ctx context.Context, key string, fields ...string) error

	// Set operations
	SAdd(ctx context.Context, key string, members ...interface{}) error
	SRem(ctx context.Context, key string, members ...interface{}) error
	SMembers(ctx context.Context, key string) ([]string, error)
	SIsMember(ctx context.Context, key string, member interface{}) (bool, error)
	SCard(ctx context.Context, key string) (int64, error)

	// Sorted Set operations
	ZAdd(ctx context.Context, key string, members ...*redis.Z) error
	ZRem(ctx context.Context, key string, members ...interface{}) error
	ZRange(ctx context.Context, key string, start, stop int64) ([]string, error)
	ZRangeByScore(ctx context.Context, key string, opt *redis.ZRangeBy) ([]string, error)
	ZScore(ctx context.Context, key, member string) (float64, error)

	// List operations
	LPush(ctx context.Context, key string, values ...interface{}) error
	RPush(ctx context.Context, key string, values ...interface{}) error
	LPop(ctx context.Context, key string) (string, error)
	RPop(ctx context.Context, key string) (string, error)
	LRange(ctx context.Context, key string, start, stop int64) ([]string, error)
	LLen(ctx context.Context, key string) (int64, error)

	// JSON operations (helper methods)
	GetJSON(ctx context.Context, key string, dest interface{}) error
	SetJSON(ctx context.Context, key string, value interface{}, expiration time.Duration) error
}

// redisRepository implements RedisRepository
type redisRepository struct {
	client *redis.Client
}

// NewRedisRepository creates a new Redis repository
func NewRedisRepository(client *redis.Client) RedisRepository {
	return &redisRepository{client: client}
}

// String operations

func (r *redisRepository) Get(ctx context.Context, key string) (string, error) {
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", fmt.Errorf("key not found: %s", key)
	}
	return val, err
}

func (r *redisRepository) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	return r.client.Set(ctx, key, value, expiration).Err()
}

func (r *redisRepository) Delete(ctx context.Context, keys ...string) error {
	return r.client.Del(ctx, keys...).Err()
}

func (r *redisRepository) Exists(ctx context.Context, key string) (bool, error) {
	count, err := r.client.Exists(ctx, key).Result()
	return count > 0, err
}

func (r *redisRepository) Expire(ctx context.Context, key string, expiration time.Duration) error {
	return r.client.Expire(ctx, key, expiration).Err()
}

// Hash operations

func (r *redisRepository) HGet(ctx context.Context, key, field string) (string, error) {
	val, err := r.client.HGet(ctx, key, field).Result()
	if err == redis.Nil {
		return "", fmt.Errorf("field not found: %s in key: %s", field, key)
	}
	return val, err
}

func (r *redisRepository) HSet(ctx context.Context, key string, values ...interface{}) error {
	return r.client.HSet(ctx, key, values...).Err()
}

func (r *redisRepository) HGetAll(ctx context.Context, key string) (map[string]string, error) {
	return r.client.HGetAll(ctx, key).Result()
}

func (r *redisRepository) HDel(ctx context.Context, key string, fields ...string) error {
	return r.client.HDel(ctx, key, fields...).Err()
}

// Set operations

func (r *redisRepository) SAdd(ctx context.Context, key string, members ...interface{}) error {
	return r.client.SAdd(ctx, key, members...).Err()
}

func (r *redisRepository) SRem(ctx context.Context, key string, members ...interface{}) error {
	return r.client.SRem(ctx, key, members...).Err()
}

func (r *redisRepository) SMembers(ctx context.Context, key string) ([]string, error) {
	return r.client.SMembers(ctx, key).Result()
}

func (r *redisRepository) SIsMember(ctx context.Context, key string, member interface{}) (bool, error) {
	return r.client.SIsMember(ctx, key, member).Result()
}

func (r *redisRepository) SCard(ctx context.Context, key string) (int64, error) {
	return r.client.SCard(ctx, key).Result()
}

// Sorted Set operations

func (r *redisRepository) ZAdd(ctx context.Context, key string, members ...*redis.Z) error {
	zs := make([]redis.Z, len(members))
	for i, m := range members {
		zs[i] = *m
	}
	return r.client.ZAdd(ctx, key, zs...).Err()
}

func (r *redisRepository) ZRem(ctx context.Context, key string, members ...interface{}) error {
	return r.client.ZRem(ctx, key, members...).Err()
}

func (r *redisRepository) ZRange(ctx context.Context, key string, start, stop int64) ([]string, error) {
	return r.client.ZRange(ctx, key, start, stop).Result()
}

func (r *redisRepository) ZRangeByScore(ctx context.Context, key string, opt *redis.ZRangeBy) ([]string, error) {
	return r.client.ZRangeByScore(ctx, key, opt).Result()
}

func (r *redisRepository) ZScore(ctx context.Context, key, member string) (float64, error) {
	return r.client.ZScore(ctx, key, member).Result()
}

// List operations

func (r *redisRepository) LPush(ctx context.Context, key string, values ...interface{}) error {
	return r.client.LPush(ctx, key, values...).Err()
}

func (r *redisRepository) RPush(ctx context.Context, key string, values ...interface{}) error {
	return r.client.RPush(ctx, key, values...).Err()
}

func (r *redisRepository) LPop(ctx context.Context, key string) (string, error) {
	val, err := r.client.LPop(ctx, key).Result()
	if err == redis.Nil {
		return "", fmt.Errorf("list is empty: %s", key)
	}
	return val, err
}

func (r *redisRepository) RPop(ctx context.Context, key string) (string, error) {
	val, err := r.client.RPop(ctx, key).Result()
	if err == redis.Nil {
		return "", fmt.Errorf("list is empty: %s", key)
	}
	return val, err
}

func (r *redisRepository) LRange(ctx context.Context, key string, start, stop int64) ([]string, error) {
	return r.client.LRange(ctx, key, start, stop).Result()
}

func (r *redisRepository) LLen(ctx context.Context, key string) (int64, error) {
	return r.client.LLen(ctx, key).Result()
}

// JSON operations (helper methods)

func (r *redisRepository) GetJSON(ctx context.Context, key string, dest interface{}) error {
	data, err := r.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return fmt.Errorf("key not found: %s", key)
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

func (r *redisRepository) SetJSON(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, key, data, expiration).Err()
}
