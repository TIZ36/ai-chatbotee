package interceptor

import (
	"context"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
)

// UnaryServerInterceptor returns a unary server interceptor for logging and error handling
func UnaryServerInterceptor(logger log.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		start := time.Now()

		// Extract metadata
		md, _ := metadata.FromIncomingContext(ctx)
		requestID := getRequestID(md)

		// Add request ID to context
		ctx = context.WithValue(ctx, "request_id", requestID)

		// Log request
		logger.Debug("gRPC unary call",
			log.String("method", info.FullMethod),
			log.String("request_id", requestID),
		)

		// Call handler
		resp, err := handler(ctx, req)

		// Log response
		duration := time.Since(start)
		if err != nil {
			logger.Error("gRPC error",
				log.String("method", info.FullMethod),
				log.String("request_id", requestID),
				log.Duration("duration", duration),
				log.Err(err),
			)
		} else {
			logger.Debug("gRPC success",
				log.String("method", info.FullMethod),
				log.String("request_id", requestID),
				log.Duration("duration", duration),
			)
		}

		return resp, err
	}
}

// StreamServerInterceptor returns a stream server interceptor for logging
func StreamServerInterceptor(logger log.Logger) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		start := time.Now()

		// Extract metadata
		md, _ := metadata.FromIncomingContext(ss.Context())
		requestID := getRequestID(md)

		// Log request
		logger.Debug("gRPC stream call",
			log.String("method", info.FullMethod),
			log.String("request_id", requestID),
		)

		// Call handler
		err := handler(srv, ss)

		// Log response
		duration := time.Since(start)
		if err != nil {
			logger.Error("gRPC stream error",
				log.String("method", info.FullMethod),
				log.String("request_id", requestID),
				log.Duration("duration", duration),
				log.Err(err),
			)
		} else {
			logger.Debug("gRPC stream success",
				log.String("method", info.FullMethod),
				log.String("request_id", requestID),
				log.Duration("duration", duration),
			)
		}

		return err
	}
}

// getRequestID extracts request ID from metadata or generates a new one
func getRequestID(md metadata.MD) string {
	if vals := md.Get("x-request-id"); len(vals) > 0 {
		return vals[0]
	}
	if vals := md.Get("request-id"); len(vals) > 0 {
		return vals[0]
	}
	return ""
}

// ErrorInterceptor returns an interceptor that converts errors to gRPC status
func ErrorInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		resp, err := handler(ctx, req)
		if err != nil {
			// Convert error to gRPC status if not already
			if _, ok := status.FromError(err); !ok {
				return nil, status.Errorf(status.Code(err), err.Error())
			}
		}
		return resp, err
	}
}

