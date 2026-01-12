package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// AnthropicConfig configures the Anthropic provider.
type AnthropicConfig struct {
	APIKey  string
	BaseURL string
	Name    string // Provider name (e.g., "anthropic", "claude")
}

// AnthropicProvider implements Provider for Anthropic (Claude) API.
type AnthropicProvider struct {
	client  *http.Client
	baseURL string
	apiKey  string
	name    string
}

// NewAnthropicProvider creates a new Anthropic provider.
func NewAnthropicProvider(config AnthropicConfig) *AnthropicProvider {
	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = "https://api.anthropic.com/v1"
	}
	name := config.Name
	if name == "" {
		name = "anthropic"
	}
	return &AnthropicProvider{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
		baseURL: baseURL,
		apiKey:  config.APIKey,
		name:    name,
	}
}

// Name returns the provider name.
func (p *AnthropicProvider) Name() string {
	return p.name
}

// Chat sends a chat completion request.
func (p *AnthropicProvider) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	systemMsg, userMsgs := p.splitMessages(req.Messages)

	payload := map[string]interface{}{
		"model":       req.Model,
		"messages":    userMsgs,
		"max_tokens":  4096,
		"temperature": 1.0,
	}

	if systemMsg != "" {
		payload["system"] = systemMsg
	}
	if req.Temperature != nil {
		payload["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		payload["max_tokens"] = *req.MaxTokens
	}
	if req.TopP != nil {
		payload["top_p"] = *req.TopP
	}
	if len(req.Stop) > 0 {
		payload["stop_sequences"] = req.Stop
	}

	// Convert tools if present
	if len(req.Tools) > 0 {
		tools := make([]map[string]interface{}, len(req.Tools))
		for i, tool := range req.Tools {
			tools[i] = map[string]interface{}{
				"name":        tool.Function.Name,
				"description": tool.Function.Description,
				"input_schema": tool.Function.Parameters,
			}
		}
		payload["tools"] = tools
	}

	url := fmt.Sprintf("%s/messages", p.baseURL)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	var apiResp struct {
		ID           string `json:"id"`
		Type         string `json:"type"`
		Role         string `json:"role"`
		Content      []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason   string `json:"stop_reason"`
		StopSequence string `json:"stop_sequence,omitempty"`
		Usage        struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Extract text content
	content := ""
	for _, block := range apiResp.Content {
		if block.Type == "text" {
			content += block.Text
		}
	}

	return &ChatResponse{
		ID:           apiResp.ID,
		Model:        req.Model,
		Message:      Message{Role: "assistant", Content: content},
		FinishReason: apiResp.StopReason,
		Usage: Usage{
			PromptTokens:     apiResp.Usage.InputTokens,
			CompletionTokens: apiResp.Usage.OutputTokens,
			TotalTokens:      apiResp.Usage.InputTokens + apiResp.Usage.OutputTokens,
		},
	}, nil
}

// ChatStream sends a streaming chat completion request.
func (p *AnthropicProvider) ChatStream(ctx context.Context, req *ChatRequest) (<-chan StreamEvent, error) {
	systemMsg, userMsgs := p.splitMessages(req.Messages)

	payload := map[string]interface{}{
		"model":       req.Model,
		"messages":    userMsgs,
		"max_tokens":  4096,
		"stream":      true,
		"temperature": 1.0,
	}

	if systemMsg != "" {
		payload["system"] = systemMsg
	}
	if req.Temperature != nil {
		payload["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		payload["max_tokens"] = *req.MaxTokens
	}
	if req.TopP != nil {
		payload["top_p"] = *req.TopP
	}
	if len(req.Stop) > 0 {
		payload["stop_sequences"] = req.Stop
	}

	// Convert tools if present
	if len(req.Tools) > 0 {
		tools := make([]map[string]interface{}, len(req.Tools))
		for i, tool := range req.Tools {
			tools[i] = map[string]interface{}{
				"name":        tool.Function.Name,
				"description": tool.Function.Description,
				"input_schema": tool.Function.Parameters,
			}
		}
		payload["tools"] = tools
	}

	url := fmt.Sprintf("%s/messages", p.baseURL)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("anthropic-beta", "messages-2023-12-15")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	ch := make(chan StreamEvent, 100)
	go func() {
		defer close(ch)
		defer resp.Body.Close()

		decoder := json.NewDecoder(resp.Body)
		var finishReason string

		for {
			var event struct {
				Type         string `json:"type"`
				Index        int    `json:"index,omitempty"`
				Delta        struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta,omitempty"`
				Message struct {
					StopReason string `json:"stop_reason"`
				} `json:"message,omitempty"`
			}

			if err := decoder.Decode(&event); err != nil {
				if err == io.EOF {
					ch <- StreamEvent{Type: "done", FinishReason: finishReason}
					return
				}
				ch <- StreamEvent{Type: "error", Error: err}
				return
			}

			switch event.Type {
			case "content_block_delta":
				if event.Delta.Type == "text_delta" && event.Delta.Text != "" {
					ch <- StreamEvent{
						Type:  "content",
						Delta: event.Delta.Text,
					}
				}
			case "message_delta":
				if event.Message.StopReason != "" {
					finishReason = event.Message.StopReason
				}
			case "message_stop":
				ch <- StreamEvent{Type: "done", FinishReason: finishReason}
				return
			}
		}
	}()

	return ch, nil
}

// ListModels lists available models.
func (p *AnthropicProvider) ListModels(ctx context.Context) ([]ModelInfo, error) {
	// Anthropic doesn't have a public models endpoint, return common models
	return []ModelInfo{
		{ID: "claude-3-5-sonnet-20241022", Name: "Claude 3.5 Sonnet", ContextSize: 200000},
		{ID: "claude-3-opus-20240229", Name: "Claude 3 Opus", ContextSize: 200000},
		{ID: "claude-3-sonnet-20240229", Name: "Claude 3 Sonnet", ContextSize: 200000},
		{ID: "claude-3-haiku-20240307", Name: "Claude 3 Haiku", ContextSize: 200000},
	}, nil
}

// CountTokens estimates token count (simplified).
func (p *AnthropicProvider) CountTokens(ctx context.Context, messages []Message) (int, error) {
	// Simple estimation: ~4 chars per token
	total := 0
	for _, m := range messages {
		total += len(m.Content) / 4
	}
	return total, nil
}

// CreateEmbedding creates embeddings (Anthropic doesn't support embeddings API).
func (p *AnthropicProvider) CreateEmbedding(ctx context.Context, texts []string, model string) (*EmbeddingResponse, error) {
	return nil, fmt.Errorf("Anthropic API does not support embeddings")
}

// splitMessages separates system messages from user messages.
func (p *AnthropicProvider) splitMessages(messages []Message) (system string, userMsgs []map[string]interface{}) {
	userMsgs = make([]map[string]interface{}, 0)
	for _, msg := range messages {
		if msg.Role == "system" {
			system = msg.Content
		} else {
			userMsg := map[string]interface{}{
				"role":    msg.Role,
				"content": msg.Content,
			}
			if msg.Name != "" {
				userMsg["name"] = msg.Name
			}
			userMsgs = append(userMsgs, userMsg)
		}
	}
	return system, userMsgs
}

