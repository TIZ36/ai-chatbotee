package llm

import (
	"context"
	"encoding/json"
	"io"

	"github.com/sashabaranov/go-openai"
)

// OpenAIConfig configures the OpenAI provider.
type OpenAIConfig struct {
	APIKey  string
	BaseURL string
	OrgID   string
	Name    string // Provider name (e.g., "openai", "deepseek")
}

// OpenAIProvider implements Provider for OpenAI API.
type OpenAIProvider struct {
	client  *openai.Client
	baseURL string
	name    string
}

// NewOpenAIProvider creates a new OpenAI provider.
func NewOpenAIProvider(config OpenAIConfig) *OpenAIProvider {
	cfg := openai.DefaultConfig(config.APIKey)
	if config.BaseURL != "" {
		cfg.BaseURL = config.BaseURL
	}
	if config.OrgID != "" {
		cfg.OrgID = config.OrgID
	}
	name := config.Name
	if name == "" {
		name = "openai"
	}
	return &OpenAIProvider{
		client:  openai.NewClientWithConfig(cfg),
		baseURL: config.BaseURL,
		name:    name,
	}
}

// Name returns the provider name.
func (p *OpenAIProvider) Name() string {
	return p.name
}

// Chat sends a chat completion request.
func (p *OpenAIProvider) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	openaiReq := p.buildRequest(req)
	resp, err := p.client.CreateChatCompletion(ctx, openaiReq)
	if err != nil {
		return nil, err
	}
	return p.parseResponse(&resp), nil
}

// ChatStream sends a streaming chat completion request.
func (p *OpenAIProvider) ChatStream(ctx context.Context, req *ChatRequest) (<-chan StreamEvent, error) {
	openaiReq := p.buildRequest(req)
	openaiReq.Stream = true
	stream, err := p.client.CreateChatCompletionStream(ctx, openaiReq)
	if err != nil {
		return nil, err
	}
	ch := make(chan StreamEvent, 100)
	go func() {
		defer close(ch)
		defer stream.Close()
		var currentToolCalls []ToolCall
		for {
			response, err := stream.Recv()
			if err == io.EOF {
				ch <- StreamEvent{Type: "done"}
				return
			}
			if err != nil {
				ch <- StreamEvent{Type: "error", Error: err}
				return
			}
			if len(response.Choices) == 0 {
				continue
			}
			choice := response.Choices[0]
			delta := choice.Delta
			// Handle content
			if delta.Content != "" {
				ch <- StreamEvent{
					Type:  "content",
					Delta: delta.Content,
				}
			}
			// Handle tool calls
			for _, tc := range delta.ToolCalls {
				if tc.Index != nil && int(*tc.Index) >= len(currentToolCalls) {
					// New tool call
					currentToolCalls = append(currentToolCalls, ToolCall{
						ID:   tc.ID,
						Type: "function",
						Function: FunctionCall{
							Name: tc.Function.Name,
						},
					})
				}
				if tc.Index != nil && int(*tc.Index) < len(currentToolCalls) {
					// Append to existing tool call arguments
					idx := int(*tc.Index)
					currentToolCalls[idx].Function.Arguments += tc.Function.Arguments
				}
			}
			// Check finish reason
			if choice.FinishReason != "" {
				if choice.FinishReason == openai.FinishReasonToolCalls {
					for _, tc := range currentToolCalls {
						ch <- StreamEvent{
							Type:     "tool_call",
							ToolCall: &tc,
						}
					}
				}
				ch <- StreamEvent{
					Type:         "done",
					FinishReason: string(choice.FinishReason),
				}
				return
			}
		}
	}()
	return ch, nil
}

// ListModels lists available models.
func (p *OpenAIProvider) ListModels(ctx context.Context) ([]ModelInfo, error) {
	resp, err := p.client.ListModels(ctx)
	if err != nil {
		return nil, err
	}
	models := make([]ModelInfo, 0, len(resp.Models))
	for _, m := range resp.Models {
		models = append(models, ModelInfo{
			ID:   m.ID,
			Name: m.ID,
		})
	}
	return models, nil
}

// CountTokens estimates token count (simplified).
func (p *OpenAIProvider) CountTokens(ctx context.Context, messages []Message) (int, error) {
	// Simple estimation: ~4 chars per token
	total := 0
	for _, m := range messages {
		total += len(m.Content) / 4
	}
	return total, nil
}

// CreateEmbedding creates embeddings for the given texts using OpenAI API.
func (p *OpenAIProvider) CreateEmbedding(ctx context.Context, texts []string, model string) (*EmbeddingResponse, error) {
	// Default to text-embedding-3-small if model is not specified
	if model == "" {
		model = "text-embedding-3-small"
	}

	req := openai.EmbeddingRequest{
		Model: openai.SmallEmbedding3,
		Input: texts,
	}

	// Map model names
	switch model {
	case "text-embedding-3-small", "small":
		req.Model = openai.SmallEmbedding3
	case "text-embedding-3-large", "large":
		req.Model = openai.LargeEmbedding3
	case "text-embedding-ada-002", "ada-002":
		req.Model = openai.AdaEmbeddingV2
	default:
		req.Model = openai.EmbeddingModel(model)
	}

	resp, err := p.client.CreateEmbeddings(ctx, req)
	if err != nil {
		return nil, err
	}

	embeddings := make([][]float32, len(resp.Data))
	for i, data := range resp.Data {
		embeddings[i] = data.Embedding
	}

	return &EmbeddingResponse{
		Model:      string(resp.Model),
		Embeddings: embeddings,
		Usage: Usage{
			PromptTokens: resp.Usage.PromptTokens,
			TotalTokens:  resp.Usage.TotalTokens,
		},
	}, nil
}

// buildRequest converts ChatRequest to OpenAI format.
func (p *OpenAIProvider) buildRequest(req *ChatRequest) openai.ChatCompletionRequest {
	messages := make([]openai.ChatCompletionMessage, len(req.Messages))
	for i, m := range req.Messages {
		msg := openai.ChatCompletionMessage{
			Role:    m.Role,
			Content: m.Content,
			Name:    m.Name,
		}
		if m.ToolCallID != "" {
			msg.ToolCallID = m.ToolCallID
		}
		if len(m.ToolCalls) > 0 {
			msg.ToolCalls = make([]openai.ToolCall, len(m.ToolCalls))
			for j, tc := range m.ToolCalls {
				msg.ToolCalls[j] = openai.ToolCall{
					ID:   tc.ID,
					Type: openai.ToolType(tc.Type),
					Function: openai.FunctionCall{
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					},
				}
			}
		}
		messages[i] = msg
	}
	openaiReq := openai.ChatCompletionRequest{
		Model:    req.Model,
		Messages: messages,
	}
	if len(req.Tools) > 0 {
		tools := make([]openai.Tool, len(req.Tools))
		for i, t := range req.Tools {
			params, _ := json.Marshal(t.Function.Parameters)
			tools[i] = openai.Tool{
				Type: openai.ToolTypeFunction,
				Function: &openai.FunctionDefinition{
					Name:        t.Function.Name,
					Description: t.Function.Description,
					Parameters:  json.RawMessage(params),
				},
			}
		}
		openaiReq.Tools = tools
	}
	if req.Temperature != nil {
		openaiReq.Temperature = float32(*req.Temperature)
	}
	if req.MaxTokens != nil {
		openaiReq.MaxTokens = *req.MaxTokens
	}
	if req.TopP != nil {
		openaiReq.TopP = float32(*req.TopP)
	}
	if len(req.Stop) > 0 {
		openaiReq.Stop = req.Stop
	}
	return openaiReq
}

// parseResponse converts OpenAI response.
func (p *OpenAIProvider) parseResponse(resp *openai.ChatCompletionResponse) *ChatResponse {
	if len(resp.Choices) == 0 {
		return &ChatResponse{}
	}
	choice := resp.Choices[0]
	msg := Message{
		Role:    choice.Message.Role,
		Content: choice.Message.Content,
	}
	if len(choice.Message.ToolCalls) > 0 {
		msg.ToolCalls = make([]ToolCall, len(choice.Message.ToolCalls))
		for i, tc := range choice.Message.ToolCalls {
			msg.ToolCalls[i] = ToolCall{
				ID:   tc.ID,
				Type: string(tc.Type),
				Function: FunctionCall{
					Name:      tc.Function.Name,
					Arguments: tc.Function.Arguments,
				},
			}
		}
	}
	return &ChatResponse{
		ID:           resp.ID,
		Model:        resp.Model,
		Message:      msg,
		FinishReason: string(choice.FinishReason),
		Usage: Usage{
			PromptTokens:     resp.Usage.PromptTokens,
			CompletionTokens: resp.Usage.CompletionTokens,
			TotalTokens:      resp.Usage.TotalTokens,
		},
	}
}
