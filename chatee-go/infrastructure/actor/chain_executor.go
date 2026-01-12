package actor

import (
	"context"
	"fmt"
	"sync"
	"time"

	"chatee-go/commonlib/actor"
)

// =============================================================================
// ChainExecutor Implementation - 具体实现
// =============================================================================

// chainExecutor implements actor.ChainExecutor
type chainExecutor struct {
	handlers map[actor.ActionType]actor.StepHandler
	mu       sync.RWMutex

	// Callbacks
	OnStepStart     func(chain *actor.ActionChain, step *actor.ActionStep)
	OnStepComplete  func(chain *actor.ActionChain, step *actor.ActionStep, result *actor.StepResult)
	OnChainStart    func(chain *actor.ActionChain)
	OnChainComplete func(chain *actor.ActionChain)
}

// NewChainExecutor creates a new chain executor.
func NewChainExecutor() *chainExecutor {
	return &chainExecutor{
		handlers: make(map[actor.ActionType]actor.StepHandler),
	}
}

// RegisterHandler registers a handler for an action type.
func (e *chainExecutor) RegisterHandler(actionType actor.ActionType, handler actor.StepHandler) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.handlers[actionType] = handler
}

// Execute runs the entire chain.
func (e *chainExecutor) Execute(ctx context.Context, chain *actor.ActionChain) error {
	chain.Mu.Lock()
	chain.Status = actor.ChainRunning
	if chain.StartTime.IsZero() {
		chain.StartTime = time.Now()
	}
	chain.Mu.Unlock()

	if e.OnChainStart != nil {
		e.OnChainStart(chain)
	}

	defer func() {
		chain.Mu.Lock()
		if chain.EndTime.IsZero() {
			chain.EndTime = time.Now()
		}
		chain.Mu.Unlock()

		if e.OnChainComplete != nil {
			e.OnChainComplete(chain)
		}
	}()

	for !chain.IsComplete() {
		step := chain.GetCurrentStep()
		if step == nil {
			break
		}

		// Check context cancellation
		select {
		case <-ctx.Done():
			chain.Mu.Lock()
			chain.Status = actor.ChainAborted
			chain.Mu.Unlock()
			return ctx.Err()
		default:
		}

		// Execute step
		if err := e.executeStep(ctx, chain, step); err != nil {
			chain.Mu.Lock()
			chain.Status = actor.ChainFailed
			chain.Mu.Unlock()
			return err
		}

		// Record history
		chain.Mu.Lock()
		chain.Context.History = append(chain.Context.History, actor.StepHistory{
			StepID:    step.ID,
			StepType:  step.Type,
			Success:   step.Result != nil && step.Result.Success,
			Output:    step.Result.Output,
			Timestamp: time.Now(),
		})
		chain.Mu.Unlock()

		// Advance to next step
		chain.Advance()
	}

	chain.Mu.Lock()
	chain.Status = actor.ChainCompleted
	chain.Mu.Unlock()

	return nil
}

// executeStep executes a single step.
func (e *chainExecutor) executeStep(ctx context.Context, chain *actor.ActionChain, step *actor.ActionStep) error {
	e.mu.RLock()
	handler, exists := e.handlers[step.Type]
	e.mu.RUnlock()

	if !exists {
		step.Status = actor.StepFailed
		step.Result = &actor.StepResult{
			Success: false,
			Error:   fmt.Sprintf("no handler for action type: %s", step.Type),
		}
		return fmt.Errorf("no handler for action type: %s", step.Type)
	}

	step.Status = actor.StepRunning
	step.StartTime = time.Now()

	if e.OnStepStart != nil {
		e.OnStepStart(chain, step)
	}

	result, err := handler(ctx, chain, step)
	step.EndTime = time.Now()

	if err != nil {
		step.Status = actor.StepFailed
		step.Result = &actor.StepResult{
			Success: false,
			Error:   err.Error(),
		}

		// Retry logic
		if step.RetryCount < step.MaxRetries {
			step.RetryCount++
			return e.executeStep(ctx, chain, step)
		}

		return err
	}

	step.Status = actor.StepCompleted
	step.Result = result

	if e.OnStepComplete != nil {
		e.OnStepComplete(chain, step, result)
	}

	return nil
}
