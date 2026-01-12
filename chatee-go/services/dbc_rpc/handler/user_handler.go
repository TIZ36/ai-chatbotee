package handler

import (
	"context"
	"database/sql"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
	"chatee-go/commonlib/snowflake"
	dbc "chatee-go/gen/dbc"
	repository "chatee-go/services/dbc_rpc/repository/mysql"
)

// UserHandler implements UserService gRPC interface
type UserHandler struct {
	dbc.UnimplementedUserServiceServer

	logger log.Logger
	repo   repository.UserRepository
}

// NewUserHandler creates a new user handler
func NewUserHandler(poolMgr *pool.PoolManager, logger log.Logger) *UserHandler {
	return &UserHandler{
		logger: logger,
		repo:   repository.NewMySQLUserRepository(poolMgr.GetGORM(), poolMgr.GetRedis()),
	}
}

// Register registers the handler with gRPC server
func (h *UserHandler) Register(server *grpc.Server) {
	dbc.RegisterUserServiceServer(server, h)
}

// CreateUser creates a new user
func (h *UserHandler) CreateUser(ctx context.Context, req *dbc.CreateUserRequest) (*dbc.User, error) {
	userID := snowflake.GenerateTypedID("user")
	now := time.Now()

	avatar := sql.NullString{}
	if req.GetAvatar() != "" {
		avatar = sql.NullString{String: req.GetAvatar(), Valid: true}
	}

	user := &repository.User{
		ID:          userID,
		Email:       req.GetEmail(),
		Name:        req.GetName(),
		Avatar:      avatar,
		Role:        req.GetRole(),
		Preferences: req.GetPreferences(),
		Metadata:    req.GetMetadata(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := h.repo.Create(ctx, user); err != nil {
		h.logger.Error("Failed to create user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create user: %v", err)
	}

	return h.toProtoUser(user), nil
}

// GetUser retrieves a user by ID
func (h *UserHandler) GetUser(ctx context.Context, req *dbc.GetUserRequest) (*dbc.User, error) {
	user, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "user not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}

	return h.toProtoUser(user), nil
}

// GetUserByEmail retrieves a user by email
func (h *UserHandler) GetUserByEmail(ctx context.Context, req *dbc.GetUserByEmailRequest) (*dbc.User, error) {
	user, err := h.repo.GetByEmail(ctx, req.GetEmail())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "user not found: %s", req.GetEmail())
		}
		h.logger.Error("Failed to get user by email", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}

	return h.toProtoUser(user), nil
}

// UpdateUser updates a user
func (h *UserHandler) UpdateUser(ctx context.Context, req *dbc.UpdateUserRequest) (*dbc.User, error) {
	user, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "user not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get user for update", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}

	// Update fields
	if req.GetName() != "" {
		user.Name = req.GetName()
	}
	if req.GetAvatar() != "" {
		user.Avatar = sql.NullString{String: req.GetAvatar(), Valid: true}
	}
	if req.GetRole() != "" {
		user.Role = req.GetRole()
	}
	if req.GetPreferences() != nil {
		user.Preferences = req.GetPreferences()
	}
	if req.GetMetadata() != nil {
		user.Metadata = req.GetMetadata()
	}
	user.UpdatedAt = time.Now()

	if err := h.repo.Update(ctx, user); err != nil {
		h.logger.Error("Failed to update user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update user: %v", err)
	}

	return h.toProtoUser(user), nil
}

// DeleteUser deletes a user
func (h *UserHandler) DeleteUser(ctx context.Context, req *dbc.DeleteUserRequest) (*dbc.DeleteUserResponse, error) {
	if err := h.repo.Delete(ctx, req.GetId()); err != nil {
		h.logger.Error("Failed to delete user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete user: %v", err)
	}

	return &dbc.DeleteUserResponse{Success: true}, nil
}

// ListUsers lists users with pagination
func (h *UserHandler) ListUsers(ctx context.Context, req *dbc.ListUsersRequest) (*dbc.ListUsersResponse, error) {
	offset := int(req.GetOffset())
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 20 // Default limit
	}

	users, err := h.repo.List(ctx, offset, limit)
	if err != nil {
		h.logger.Error("Failed to list users", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list users: %v", err)
	}

	protoUsers := make([]*dbc.User, 0, len(users))
	for _, user := range users {
		protoUsers = append(protoUsers, h.toProtoUser(user))
	}

	return &dbc.ListUsersResponse{
		Users: protoUsers,
		Total: int32(len(protoUsers)), // TODO: Get actual total count
	}, nil
}

// toProtoUser converts repository User to proto User
func (h *UserHandler) toProtoUser(user *repository.User) *dbc.User {
	avatar := ""
	if user.Avatar.Valid {
		avatar = user.Avatar.String
	}

	return &dbc.User{
		Id:          user.ID,
		Email:       user.Email,
		Name:        user.Name,
		Avatar:      avatar,
		Role:        user.Role,
		Preferences: user.Preferences,
		Metadata:    user.Metadata,
		CreatedAt:   user.CreatedAt.Unix(),
		UpdatedAt:   user.UpdatedAt.Unix(),
	}
}
