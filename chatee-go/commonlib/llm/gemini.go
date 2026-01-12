package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GeminiConfig configures the Google Gemini provider.
type GeminiConfig struct {
	APIKey  string
	BaseURL string
	Name    string // Provider name (e.g., "gemini", "google")
}

// GeminiProvider implements Provider for Google Gemini API.
type GeminiProvider struct {
	client  *http.Client
	baseURL string
	apiKey  string
	name    string
}

// NewGeminiProvider creates a new Gemini provider.
func NewGeminiProvider(config GeminiConfig) *GeminiProvider {
	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta"
	}
	name := config.Name
	if name == "" {
		name = "gemini"
	}
	return &GeminiProvider{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
		baseURL: baseURL,
		apiKey:  config.APIKey,
		name:    name,
	}
}

// Name returns the provider name.
func (p *GeminiProvider) Name() string {
	return p.name
}

// Chat sends a chat completion request.
func (p *GeminiProvider) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	contents, systemInstruction := p.convertMessages(req.Messages)

	model := req.Model
	if model == "" {
		model = "gemini-2.0-flash-exp"
	}

	payload := map[string]interface{}{
		"contents": contents,
	}

	if systemInstruction != nil {
		payload["systemInstruction"] = systemInstruction
	}

	// Generation config
	genConfig := make(map[string]interface{})
	if req.Temperature != nil {
		genConfig["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		genConfig["maxOutputTokens"] = *req.MaxTokens
	}
	if req.TopP != nil {
		genConfig["topP"] = *req.TopP
	}
	if len(req.Stop) > 0 {
		genConfig["stopSequences"] = req.Stop
	}
	if len(genConfig) > 0 {
		payload["generationConfig"] = genConfig
	}

	// Convert tools if present
	if len(req.Tools) > 0 {
		tools := make([]map[string]interface{}, len(req.Tools))
		for i, tool := range req.Tools {
			tools[i] = map[string]interface{}{
				"functionDeclarations": []map[string]interface{}{
					{
						"name":        tool.Function.Name,
						"description": tool.Function.Description,
						"parameters":  tool.Function.Parameters,
					},
				},
			}
		}
		payload["tools"] = tools
	}

	apiURL := fmt.Sprintf("%s/models/%s:generateContent", p.baseURL, model)
	apiURL += "?key=" + url.QueryEscape(p.apiKey)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

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
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
			TotalTokenCount      int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(apiResp.Candidates) == 0 {
		return nil, fmt.Errorf("no candidates in response")
	}

	// Extract text content
	content := ""
	for _, part := range apiResp.Candidates[0].Content.Parts {
		content += part.Text
	}

	finishReason := apiResp.Candidates[0].FinishReason
	if finishReason == "" {
		finishReason = "stop"
	}

	return &ChatResponse{
		ID:           fmt.Sprintf("gemini-%d", time.Now().Unix()),
		Model:        model,
		Message:      Message{Role: "model", Content: content},
		FinishReason: finishReason,
		Usage: Usage{
			PromptTokens:     apiResp.UsageMetadata.PromptTokenCount,
			CompletionTokens: apiResp.UsageMetadata.CandidatesTokenCount,
			TotalTokens:      apiResp.UsageMetadata.TotalTokenCount,
		},
	}, nil
}

// ChatStream sends a streaming chat completion request.
func (p *GeminiProvider) ChatStream(ctx context.Context, req *ChatRequest) (<-chan StreamEvent, error) {
	contents, systemInstruction := p.convertMessages(req.Messages)

	model := req.Model
	if model == "" {
		model = "gemini-2.0-flash-exp"
	}

	payload := map[string]interface{}{
		"contents": contents,
	}

	if systemInstruction != nil {
		payload["systemInstruction"] = systemInstruction
	}

	// Generation config
	genConfig := make(map[string]interface{})
	if req.Temperature != nil {
		genConfig["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		genConfig["maxOutputTokens"] = *req.MaxTokens
	}
	if req.TopP != nil {
		genConfig["topP"] = *req.TopP
	}
	if len(req.Stop) > 0 {
		genConfig["stopSequences"] = req.Stop
	}
	if len(genConfig) > 0 {
		payload["generationConfig"] = genConfig
	}

	// Convert tools if present
	if len(req.Tools) > 0 {
		tools := make([]map[string]interface{}, len(req.Tools))
		for i, tool := range req.Tools {
			tools[i] = map[string]interface{}{
				"functionDeclarations": []map[string]interface{}{
					{
						"name":        tool.Function.Name,
						"description": tool.Function.Description,
						"parameters":  tool.Function.Parameters,
					},
				},
			}
		}
		payload["tools"] = tools
	}

	apiURL := fmt.Sprintf("%s/models/%s:streamGenerateContent", p.baseURL, model)
	apiURL += "?alt=sse&key=" + url.QueryEscape(p.apiKey)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

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
				Candidates []struct {
					Content struct {
						Parts []struct {
							Text string `json:"text"`
						} `json:"parts"`
					} `json:"content"`
					FinishReason string `json:"finishReason"`
				} `json:"candidates"`
			}

			if err := decoder.Decode(&event); err != nil {
				if err == io.EOF {
					ch <- StreamEvent{Type: "done", FinishReason: finishReason}
					return
				}
				ch <- StreamEvent{Type: "error", Error: err}
				return
			}

			if len(event.Candidates) > 0 {
				candidate := event.Candidates[0]
				for _, part := range candidate.Content.Parts {
					if part.Text != "" {
						ch <- StreamEvent{
							Type:  "content",
							Delta: part.Text,
						}
					}
				}
				if candidate.FinishReason != "" {
					finishReason = candidate.FinishReason
				}
			}
		}
	}()

	return ch, nil
}

// ListModels lists available models.
func (p *GeminiProvider) ListModels(ctx context.Context) ([]ModelInfo, error) {
	apiURL := fmt.Sprintf("%s/models", p.baseURL)
	apiURL += "?key=" + url.QueryEscape(p.apiKey)

	httpReq, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

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
		Models []struct {
			Name        string `json:"name"`
			DisplayName string `json:"displayName"`
		} `json:"models"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	models := make([]ModelInfo, 0, len(apiResp.Models))
	for _, m := range apiResp.Models {
		// Extract model ID from name (e.g., "models/gemini-2.0-flash-exp" -> "gemini-2.0-flash-exp")
		modelID := m.Name
		if strings.Contains(modelID, "/") {
			parts := strings.Split(modelID, "/")
			modelID = parts[len(parts)-1]
		}
		models = append(models, ModelInfo{
			ID:          modelID,
			Name:        m.DisplayName,
			Description: m.Name,
		})
	}

	return models, nil
}

// CountTokens estimates token count (simplified).
func (p *GeminiProvider) CountTokens(ctx context.Context, messages []Message) (int, error) {
	// Simple estimation: ~4 chars per token
	total := 0
	for _, m := range messages {
		total += len(m.Content) / 4
	}
	return total, nil
}

// CreateEmbedding creates embeddings (Gemini doesn't have a separate embeddings API, but we can use text-embedding-004).
func (p *GeminiProvider) CreateEmbedding(ctx context.Context, texts []string, model string) (*EmbeddingResponse, error) {
	// Gemini doesn't have a standard embeddings API like OpenAI
	// For now, return error - in the future, we might use text-embedding-004 model
	return nil, fmt.Errorf("Gemini API does not support embeddings via standard API")
}

// convertMessages converts messages to Gemini format.
func (p *GeminiProvider) convertMessages(messages []Message) (contents []map[string]interface{}, systemInstruction map[string]interface{}) {
	contents = make([]map[string]interface{}, 0)
	
	for _, msg := range messages {
		if msg.Role == "system" {
			systemInstruction = map[string]interface{}{
				"parts": []map[string]interface{}{
					{"text": msg.Content},
				},
			}
			continue
		}

		// Convert role: assistant -> model, user -> user
		role := msg.Role
		if role == "assistant" {
			role = "model"
		}

		parts := []map[string]interface{}{
			{"text": msg.Content},
		}

		content := map[string]interface{}{
			"role":  role,
			"parts": parts,
		}

		contents = append(contents, content)
	}

	return contents, systemInstruction
}

