package log

import (
	"context"
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

// =============================================================================
// Logger Interface
// =============================================================================

// Logger is the logging interface.
type Logger interface {
	Debug(msg string, fields ...Field)
	Info(msg string, fields ...Field)
	Warn(msg string, fields ...Field)
	Error(msg string, fields ...Field)
	Fatal(msg string, fields ...Field)
	With(fields ...Field) Logger
	WithContext(ctx context.Context) Logger
	Sync() error
}

// Field is a logging field.
type Field = zap.Field

// Common field constructors (re-exported from zap)
var (
	String   = zap.String
	Int      = zap.Int
	Int64    = zap.Int64
	Float64  = zap.Float64
	Bool     = zap.Bool
	Err      = zap.Error // Err is an alias for zap.Error to avoid conflict with Error method
	Any      = zap.Any
	Duration = zap.Duration
	Time     = zap.Time
)

// =============================================================================
// LogConfig
// =============================================================================

// LogConfig configures the logger.
type LogConfig struct {
	Level      string `json:"level"`       // debug, info, warn, error
	Format     string `json:"format"`      // json, console
	OutputPath string `json:"output_path"` // file path or "stdout"/"stderr"
	AddCaller  bool   `json:"add_caller"`  // whether to add caller information
	// Log rotation settings (only used when OutputPath is a file path)
	MaxSize    int  `json:"max_size"`    // MB, default 100
	MaxBackups int  `json:"max_backups"` // default 3
	MaxAge     int  `json:"max_age"`     // days, default 30
	Compress   bool `json:"compress"`    // whether to compress rotated logs
}

// =============================================================================
// ZapLogger Implementation
// =============================================================================

// ZapLogger wraps zap.Logger.
type ZapLogger struct {
	logger *zap.Logger
	sugar  *zap.SugaredLogger
}

// NewLogger creates a new logger.
func NewLogger(config LogConfig) (*ZapLogger, error) {
	// Parse log level
	level := zapcore.InfoLevel
	switch config.Level {
	case "debug":
		level = zapcore.DebugLevel
	case "info":
		level = zapcore.InfoLevel
	case "warn":
		level = zapcore.WarnLevel
	case "error":
		level = zapcore.ErrorLevel
	}

	// Create encoder config
	encoderConfig := zapcore.EncoderConfig{
		TimeKey:        "time",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		FunctionKey:    zapcore.OmitKey,
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.MillisDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}

	// Create encoder
	var encoder zapcore.Encoder
	if config.Format == "console" {
		encoder = zapcore.NewConsoleEncoder(encoderConfig)
	} else {
		encoder = zapcore.NewJSONEncoder(encoderConfig)
	}

	// Create output
	var output zapcore.WriteSyncer
	switch config.OutputPath {
	case "", "stdout":
		output = zapcore.AddSync(os.Stdout)
	case "stderr":
		output = zapcore.AddSync(os.Stderr)
	default:
		// File output with rotation
		writer := &lumberjack.Logger{
			Filename:   config.OutputPath,
			MaxSize:    config.MaxSize, // MB
			MaxBackups: config.MaxBackups,
			MaxAge:     config.MaxAge, // days
			Compress:   config.Compress,
		}
		// Set defaults if not specified
		if config.MaxSize == 0 {
			writer.MaxSize = 100
		}
		if config.MaxBackups == 0 {
			writer.MaxBackups = 3
		}
		if config.MaxAge == 0 {
			writer.MaxAge = 30
		}
		output = zapcore.AddSync(writer)
	}

	// Create core
	core := zapcore.NewCore(encoder, output, level)

	// Create logger
	opts := []zap.Option{}
	if config.AddCaller {
		opts = append(opts, zap.AddCaller(), zap.AddCallerSkip(1))
	}

	logger := zap.New(core, opts...)

	return &ZapLogger{
		logger: logger,
		sugar:  logger.Sugar(),
	}, nil
}

// Debug logs a debug message.
func (l *ZapLogger) Debug(msg string, fields ...Field) {
	l.logger.Debug(msg, fields...)
}

// Info logs an info message.
func (l *ZapLogger) Info(msg string, fields ...Field) {
	l.logger.Info(msg, fields...)
}

// Warn logs a warning message.
func (l *ZapLogger) Warn(msg string, fields ...Field) {
	l.logger.Warn(msg, fields...)
}

// Error logs an error message.
func (l *ZapLogger) Error(msg string, fields ...Field) {
	l.logger.Error(msg, fields...)
}

// Fatal logs a fatal message and exits.
func (l *ZapLogger) Fatal(msg string, fields ...Field) {
	l.logger.Fatal(msg, fields...)
}

// With returns a logger with the given fields.
func (l *ZapLogger) With(fields ...Field) Logger {
	return &ZapLogger{
		logger: l.logger.With(fields...),
	}
}

// WithContext returns a logger with context fields.
func (l *ZapLogger) WithContext(ctx context.Context) Logger {
	fields := extractContextFields(ctx)
	if len(fields) == 0 {
		return l
	}
	return l.With(fields...)
}

// Sync flushes any buffered log entries.
func (l *ZapLogger) Sync() error {
	return l.logger.Sync()
}

// =============================================================================
// Context Keys
// =============================================================================

type contextKey string

const (
	RequestIDKey contextKey = "request_id"
	UserIDKey    contextKey = "user_id"
	SessionIDKey contextKey = "session_id"
	TraceIDKey   contextKey = "trace_id"
	SpanIDKey    contextKey = "span_id"
)

// WithRequestID adds request ID to context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, RequestIDKey, id)
}

// WithUserID adds user ID to context.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, UserIDKey, id)
}

// WithSessionID adds session ID to context.
func WithSessionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, SessionIDKey, id)
}

// WithTraceID adds trace ID to context.
func WithTraceID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, TraceIDKey, id)
}

// WithSpanID adds span ID to context.
func WithSpanID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, SpanIDKey, id)
}

// extractContextFields extracts logging fields from context.
func extractContextFields(ctx context.Context) []Field {
	var fields []Field

	if v := ctx.Value(RequestIDKey); v != nil {
		if s, ok := v.(string); ok && s != "" {
			fields = append(fields, String("request_id", s))
		}
	}

	if v := ctx.Value(UserIDKey); v != nil {
		if s, ok := v.(string); ok && s != "" {
			fields = append(fields, String("user_id", s))
		}
	}

	if v := ctx.Value(SessionIDKey); v != nil {
		if s, ok := v.(string); ok && s != "" {
			fields = append(fields, String("session_id", s))
		}
	}

	if v := ctx.Value(TraceIDKey); v != nil {
		if s, ok := v.(string); ok && s != "" {
			fields = append(fields, String("trace_id", s))
		}
	}

	if v := ctx.Value(SpanIDKey); v != nil {
		if s, ok := v.(string); ok && s != "" {
			fields = append(fields, String("span_id", s))
		}
	}

	return fields
}

// =============================================================================
// Global Logger
// =============================================================================

var globalLogger Logger = &ZapLogger{logger: zap.NewNop()}

// Init initializes the global logger.
func Init(config LogConfig) error {
	logger, err := NewLogger(config)
	if err != nil {
		return err
	}
	globalLogger = logger
	return nil
}

// Default returns the global logger.
func Default() Logger {
	return globalLogger
}

// SetDefault sets the global logger.
func SetDefault(logger Logger) {
	globalLogger = logger
}

// Debug logs a debug message using the global logger.
func Debug(msg string, fields ...Field) {
	globalLogger.Debug(msg, fields...)
}

// Info logs an info message using the global logger.
func Info(msg string, fields ...Field) {
	globalLogger.Info(msg, fields...)
}

// Warn logs a warning message using the global logger.
func Warn(msg string, fields ...Field) {
	globalLogger.Warn(msg, fields...)
}

// Error logs an error message using the global logger.
func Error(msg string, fields ...Field) {
	globalLogger.Error(msg, fields...)
}

// Fatal logs a fatal message using the global logger and exits.
func Fatal(msg string, fields ...Field) {
	globalLogger.Fatal(msg, fields...)
}

// L returns a logger with context.
func L(ctx context.Context) Logger {
	return globalLogger.WithContext(ctx)
}
