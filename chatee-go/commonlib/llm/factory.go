package llm

import (
	"fmt"
	"strings"
)

// CreateProvider creates a provider from config.
func CreateProvider(config ProviderConfig) (Provider, error) {
	switch strings.ToLower(config.Type) {
	case "openai":
		return NewOpenAIProvider(OpenAIConfig{
			Name:    "openai",
			BaseURL: config.BaseURL,
			APIKey:  config.APIKey,
		}), nil
	case "deepseek":
		baseURL := config.BaseURL
		if baseURL == "" {
			baseURL = "https://api.deepseek.com"
		}
		return NewOpenAIProvider(OpenAIConfig{
			Name:    "deepseek",
			BaseURL: baseURL,
			APIKey:  config.APIKey,
		}), nil
	case "openrouter":
		baseURL := config.BaseURL
		if baseURL == "" {
			baseURL = "https://openrouter.ai/api/v1"
		}
		return NewOpenAIProvider(OpenAIConfig{
			Name:    "openrouter",
			BaseURL: baseURL,
			APIKey:  config.APIKey,
		}), nil
	case "anthropic", "claude", "claudecode":
		baseURL := config.BaseURL
		if baseURL == "" {
			baseURL = "https://api.anthropic.com/v1"
		}
		return NewAnthropicProvider(AnthropicConfig{
			Name:    strings.ToLower(config.Type),
			BaseURL: baseURL,
			APIKey:  config.APIKey,
		}), nil
	case "gemini", "google":
		baseURL := config.BaseURL
		if baseURL == "" {
			baseURL = "https://generativelanguage.googleapis.com/v1beta"
		}
		return NewGeminiProvider(GeminiConfig{
			Name:    "gemini",
			BaseURL: baseURL,
			APIKey:  config.APIKey,
		}), nil
	default:
		return nil, fmt.Errorf("unknown provider type: %s", config.Type)
	}
}
