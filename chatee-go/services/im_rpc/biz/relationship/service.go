package relationship

import (
	"context"
	"fmt"
	"time"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
)

// =============================================================================
// Relationship Service - 用户关系管理
// =============================================================================

// Service manages user relationships (following, followers, friends)
type Service struct {
	cfg Config
}

// Config holds the relationship service configuration
type Config struct {
	Pools  *pool.PoolManager
	Logger log.Logger
}

// NewService creates a new relationship service
func NewService(cfg Config) *Service {
	return &Service{cfg: cfg}
}

// =============================================================================
// Following/Follower Management
// =============================================================================

// Follow adds a following relationship
func (s *Service) Follow(ctx context.Context, followerID, followeeID string) error {
	redis := s.cfg.Pools.GetRedis()

	// Add to follower's following set
	followingKey := fmt.Sprintf("user:%s:following", followerID)
	if err := redis.SAdd(ctx, followingKey, followeeID).Err(); err != nil {
		return fmt.Errorf("failed to add following: %w", err)
	}

	// Add to followee's followers set
	followersKey := fmt.Sprintf("user:%s:followers", followeeID)
	if err := redis.SAdd(ctx, followersKey, followerID).Err(); err != nil {
		return fmt.Errorf("failed to add follower: %w", err)
	}

	// Check if bidirectional (friends)
	if s.isFollowing(ctx, followeeID, followerID) {
		// Add to both friends sets
		friendsKey1 := fmt.Sprintf("user:%s:friends", followerID)
		friendsKey2 := fmt.Sprintf("user:%s:friends", followeeID)
		redis.SAdd(ctx, friendsKey1, followeeID)
		redis.SAdd(ctx, friendsKey2, followerID)
	}

	return nil
}

// Unfollow removes a following relationship
func (s *Service) Unfollow(ctx context.Context, followerID, followeeID string) error {
	redis := s.cfg.Pools.GetRedis()

	// Remove from follower's following set
	followingKey := fmt.Sprintf("user:%s:following", followerID)
	if err := redis.SRem(ctx, followingKey, followeeID).Err(); err != nil {
		return fmt.Errorf("failed to remove following: %w", err)
	}

	// Remove from followee's followers set
	followersKey := fmt.Sprintf("user:%s:followers", followeeID)
	if err := redis.SRem(ctx, followersKey, followerID).Err(); err != nil {
		return fmt.Errorf("failed to remove follower: %w", err)
	}

	// Remove from friends sets if they were friends
	friendsKey1 := fmt.Sprintf("user:%s:friends", followerID)
	friendsKey2 := fmt.Sprintf("user:%s:friends", followeeID)
	redis.SRem(ctx, friendsKey1, followeeID)
	redis.SRem(ctx, friendsKey2, followerID)

	return nil
}

// IsFollowing checks if userA is following userB
func (s *Service) IsFollowing(ctx context.Context, followerID, followeeID string) bool {
	return s.isFollowing(ctx, followerID, followeeID)
}

func (s *Service) isFollowing(ctx context.Context, followerID, followeeID string) bool {
	redis := s.cfg.Pools.GetRedis()
	followingKey := fmt.Sprintf("user:%s:following", followerID)
	result, err := redis.SIsMember(ctx, followingKey, followeeID).Result()
	return err == nil && result
}

// GetFollowers returns all followers of a user
func (s *Service) GetFollowers(ctx context.Context, userID string) ([]string, error) {
	redis := s.cfg.Pools.GetRedis()
	followersKey := fmt.Sprintf("user:%s:followers", userID)
	followers, err := redis.SMembers(ctx, followersKey).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get followers: %w", err)
	}
	return followers, nil
}

// GetFollowing returns all users that a user is following
func (s *Service) GetFollowing(ctx context.Context, userID string) ([]string, error) {
	redis := s.cfg.Pools.GetRedis()
	followingKey := fmt.Sprintf("user:%s:following", userID)
	following, err := redis.SMembers(ctx, followingKey).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get following: %w", err)
	}
	return following, nil
}

// GetFriends returns all friends (bidirectional following) of a user
func (s *Service) GetFriends(ctx context.Context, userID string) ([]string, error) {
	redis := s.cfg.Pools.GetRedis()
	friendsKey := fmt.Sprintf("user:%s:friends", userID)
	friends, err := redis.SMembers(ctx, friendsKey).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get friends: %w", err)
	}
	return friends, nil
}

// =============================================================================
// Permission Checks
// =============================================================================

// CanMentionUser checks if userA can mention userB
// Rules: userA must be friends with userB (bidirectional following)
func (s *Service) CanMentionUser(ctx context.Context, mentionerID, mentionedID string) bool {
	return s.isFollowing(ctx, mentionerID, mentionedID) && s.isFollowing(ctx, mentionedID, mentionerID)
}

// CanReplyToThread checks if user can reply to a thread
// Rules: user must be following the thread owner
func (s *Service) CanReplyToThread(ctx context.Context, userID, threadOwnerID string) bool {
	return s.isFollowing(ctx, userID, threadOwnerID)
}

// CanMentionAI checks if an AI agent is in the thread
func (s *Service) CanMentionAI(ctx context.Context, threadID, aiAgentID string) bool {
	// This should check if AI is in thread's ai_agents list
	// For now, we'll use a simple Redis check
	redis := s.cfg.Pools.GetRedis()
	key := fmt.Sprintf("thread:%s:ai_agents", threadID)
	result, err := redis.SIsMember(ctx, key, aiAgentID).Result()
	return err == nil && result
}

// =============================================================================
// Access Control
// =============================================================================

// GetAccessLevel returns access level for a user to a thread/chat
// Returns: "full" | "preview" | "denied"
func (s *Service) GetAccessLevel(ctx context.Context, userID, resourceType, resourceID string) string {
	redis := s.cfg.Pools.GetRedis()
	key := fmt.Sprintf("access:%s:%s:%s", userID, resourceType, resourceID)
	
	level, err := redis.Get(ctx, key).Result()
	if err == redis.Nil {
		// Default: check if user is following owner
		if resourceType == "thread" {
			// Get thread owner and check following
			threadMetaKey := fmt.Sprintf("thread:%s:owner", resourceID)
			ownerID, err := redis.Get(ctx, threadMetaKey).Result()
			if err == nil && s.isFollowing(ctx, userID, ownerID) {
				return "full"
			}
			return "preview"
		}
		return "preview"
	}
	if err != nil {
		return "denied"
	}
	return level
}

// SetAccessLevel sets access level for a user to a resource
func (s *Service) SetAccessLevel(ctx context.Context, userID, resourceType, resourceID, level string, ttl time.Duration) error {
	redis := s.cfg.Pools.GetRedis()
	key := fmt.Sprintf("access:%s:%s:%s", userID, resourceType, resourceID)
	return redis.Set(ctx, key, level, ttl).Err()
}
