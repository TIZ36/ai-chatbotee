package pool

import (
	"fmt"

	"chatee-go/commonlib/log"
	"github.com/tiz36/ghbase/domain"
)

// HBaseLoggerAdapter adapts commonlib/log.Logger to ghbase/domain.Logger
type HBaseLoggerAdapter struct {
	logger log.Logger
}

// NewHBaseLoggerAdapter creates a new logger adapter
func NewHBaseLoggerAdapter(logger log.Logger) domain.Logger {
	return &HBaseLoggerAdapter{logger: logger}
}

// Info logs an info message
func (a *HBaseLoggerAdapter) Info(args ...interface{}) {
	a.logger.Info(fmt.Sprint(args...))
}

// Infof logs a formatted info message
func (a *HBaseLoggerAdapter) Infof(format string, args ...interface{}) {
	a.logger.Info(fmt.Sprintf(format, args...))
}

// Error logs an error message
func (a *HBaseLoggerAdapter) Error(args ...interface{}) {
	a.logger.Error(fmt.Sprint(args...))
}

// Errorf logs a formatted error message
func (a *HBaseLoggerAdapter) Errorf(format string, args ...interface{}) {
	a.logger.Error(fmt.Sprintf(format, args...))
}

// Debugf logs a formatted debug message
func (a *HBaseLoggerAdapter) Debugf(format string, args ...interface{}) {
	a.logger.Debug(fmt.Sprintf(format, args...))
}
