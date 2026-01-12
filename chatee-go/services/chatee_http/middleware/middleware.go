package middleware

import (
	"bytes"
	"io"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"chatee-go/commonlib/log"
)

// =============================================================================
// Request ID Middleware
// =============================================================================

// RequestID adds a unique request ID to each request.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)
		// Add to context
		ctx := log.WithRequestID(c.Request.Context(), requestID)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

// =============================================================================
// Logger Middleware
// =============================================================================

// Logger logs request and response details.
func Logger(logger log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery
		// Get request ID
		requestID, _ := c.Get("request_id")
		// Log after request
		c.Next()
		latency := time.Since(start)
		status := c.Writer.Status()
		fields := []log.Field{
			log.String("request_id", requestID.(string)),
			log.String("method", c.Request.Method),
			log.String("path", path),
			log.String("query", query),
			log.Int("status", status),
			log.Duration("latency", latency),
			log.String("client_ip", c.ClientIP()),
			log.String("user_agent", c.Request.UserAgent()),
		}
		if status >= 500 {
			logger.Error("HTTP request", fields...)
		} else if status >= 400 {
			logger.Warn("HTTP request", fields...)
		} else {
			logger.Info("HTTP request", fields...)
		}
	}
}

// =============================================================================
// Recovery Middleware
// =============================================================================

// Recovery recovers from panics.
func Recovery(logger log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				requestID, _ := c.Get("request_id")
				logger.Error("Panic recovered",
					log.String("request_id", requestID.(string)),
					log.Any("error", err),
					log.String("path", c.Request.URL.Path),
				)
				c.AbortWithStatusJSON(500, gin.H{
					"error":      "Internal server error",
					"request_id": requestID,
				})
			}
		}()
		c.Next()
	}
}

// =============================================================================
// CORS Middleware
// =============================================================================

// CORS adds CORS headers.
func CORS(allowedOrigins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		// Check if origin is allowed
		allowed := false
		for _, o := range allowedOrigins {
			if o == "*" || o == origin {
				allowed = true
				break
			}
		}
		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// =============================================================================
// Auth Middleware
// =============================================================================

// Auth validates authentication.
func Auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(401, gin.H{
				"error": "Authorization header required",
			})
			return
		}
		// TODO: Validate JWT token
		// For now, just pass through
		c.Next()
	}
}

// =============================================================================
// Rate Limiter Middleware
// =============================================================================

// RateLimiter limits request rate.
// TODO: Implement with Redis
func RateLimiter(rps int) gin.HandlerFunc {
	return func(c *gin.Context) {
		// TODO: Implement rate limiting with Redis
		c.Next()
	}
}

// =============================================================================
// Admin Middleware
// =============================================================================

// AdminAuth validates admin authentication and permissions.
func AdminAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(401, gin.H{
				"error": "Authorization header required",
			})
			return
		}

		// TODO: Validate JWT token and check admin role
		// For now, we'll extract user info from token
		// In production, you should:
		// 1. Parse JWT token
		// 2. Check if user has admin role
		// 3. Set user info in context

		// Placeholder: Extract user ID from token (assuming Bearer token format)
		// token := strings.TrimPrefix(authHeader, "Bearer ")
		// userID, role := parseToken(token)
		// if role != "admin" {
		// 	c.AbortWithStatusJSON(403, gin.H{
		// 		"error": "Admin access required",
		// 	})
		// 	return
		// }

		// For now, just pass through (will be implemented with proper JWT validation)
		c.Set("is_admin", true) // Placeholder
		c.Next()
	}
}

// =============================================================================
// Body Logger Middleware (for debugging)
// =============================================================================

// BodyLogger logs request/response bodies (use only in development).
func BodyLogger(logger log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Read request body
		var requestBody []byte
		if c.Request.Body != nil {
			requestBody, _ = io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(requestBody))
		}
		// Create response writer wrapper
		blw := &bodyLogWriter{body: bytes.NewBufferString(""), ResponseWriter: c.Writer}
		c.Writer = blw
		c.Next()
		requestID, _ := c.Get("request_id")
		// Log bodies
		if len(requestBody) > 0 && len(requestBody) < 10000 {
			logger.Debug("Request body",
				log.String("request_id", requestID.(string)),
				log.String("body", string(requestBody)),
			)
		}
		if blw.body.Len() > 0 && blw.body.Len() < 10000 {
			logger.Debug("Response body",
				log.String("request_id", requestID.(string)),
				log.String("body", blw.body.String()),
			)
		}
	}
}

type bodyLogWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w bodyLogWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}
