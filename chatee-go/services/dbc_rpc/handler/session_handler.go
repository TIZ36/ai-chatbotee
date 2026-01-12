package handler

import (
	"context"
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

// SessionHandler implements SessionService gRPC interface
type SessionHandler struct {
	dbc.UnimplementedSessionServiceServer

	logger log.Logger
	repo   repository.SessionRepository
}

// NewSessionHandler creates a new session handler
func NewSessionHandler(poolMgr *pool.PoolManager, logger log.Logger) *SessionHandler {
	return &SessionHandler{
		logger: logger,
		repo:   repository.NewMySQLSessionRepository(poolMgr.GetGORM(), poolMgr.GetRedis()),
	}
}

// Register registers the handler with gRPC server
func (h *SessionHandler) Register(server *grpc.Server) {
	dbc.RegisterSessionServiceServer(server, h)
}

// CreateSession creates a new session
func (h *SessionHandler) CreateSession(ctx context.Context, req *dbc.CreateSessionRequest) (*dbc.Session, error) {
	sessionID := snowflake.GenerateTypedID("session")
	now := time.Now()

	session := &repository.Session{
		ID:        sessionID,
		UserID:    req.GetUserId(),
		AgentID:   req.GetAgentId(),
		Title:     req.GetTitle(),
		Status:    "active",
		Metadata:  req.GetMetadata(),
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := h.repo.Create(ctx, session); err != nil {
		h.logger.Error("Failed to create session", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create session: %v", err)
	}

	return h.toProtoSession(session), nil
}

// GetSession retrieves a session by ID
func (h *SessionHandler) GetSession(ctx context.Context, req *dbc.GetSessionRequest) (*dbc.Session, error) {
	session, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "session not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get session", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get session: %v", err)
	}

	return h.toProtoSession(session), nil
}

// GetSessionsByUser retrieves sessions for a user
func (h *SessionHandler) GetSessionsByUser(ctx context.Context, req *dbc.GetSessionsByUserRequest) (*dbc.GetSessionsByUserResponse, error) {
	offset := int(req.GetOffset())
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 20 // Default limit
	}

	sessions, err := h.repo.GetByUserID(ctx, req.GetUserId(), offset, limit)
	if err != nil {
		h.logger.Error("Failed to get sessions by user", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get sessions: %v", err)
	}

	protoSessions := make([]*dbc.Session, 0, len(sessions))
	for _, session := range sessions {
		protoSessions = append(protoSessions, h.toProtoSession(session))
	}

	return &dbc.GetSessionsByUserResponse{
		Sessions: protoSessions,
	}, nil
}

// UpdateSession updates a session
func (h *SessionHandler) UpdateSession(ctx context.Context, req *dbc.UpdateSessionRequest) (*dbc.Session, error) {
	session, err := h.repo.GetByID(ctx, req.GetId())
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, status.Errorf(codes.NotFound, "session not found: %s", req.GetId())
		}
		h.logger.Error("Failed to get session for update", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get session: %v", err)
	}

	// Update fields
	if req.GetTitle() != "" {
		session.Title = req.GetTitle()
	}
	if req.GetStatus() != "" {
		session.Status = req.GetStatus()
	}
	if req.GetMetadata() != nil {
		session.Metadata = req.GetMetadata()
	}
	session.UpdatedAt = time.Now()

	if err := h.repo.Update(ctx, session); err != nil {
		h.logger.Error("Failed to update session", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update session: %v", err)
	}

	return h.toProtoSession(session), nil
}

// DeleteSession deletes a session
func (h *SessionHandler) DeleteSession(ctx context.Context, req *dbc.DeleteSessionRequest) (*dbc.DeleteSessionResponse, error) {
	if err := h.repo.Delete(ctx, req.GetId()); err != nil {
		h.logger.Error("Failed to delete session", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete session: %v", err)
	}

	return &dbc.DeleteSessionResponse{Success: true}, nil
}

// toProtoSession converts repository Session to proto Session
func (h *SessionHandler) toProtoSession(session *repository.Session) *dbc.Session {
	return &dbc.Session{
		Id:        session.ID,
		UserId:    session.UserID,
		AgentId:   session.AgentID,
		Title:     session.Title,
		Status:    session.Status,
		Metadata:  session.Metadata,
		CreatedAt: session.CreatedAt.Unix(),
		UpdatedAt: session.UpdatedAt.Unix(),
	}
}
