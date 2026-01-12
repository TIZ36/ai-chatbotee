package llm

import (
	"context"
	"testing"
)

// TestProviderRegistry tests the provider registry
func TestProviderRegistry(t *testing.T) {
	registry := NewRegistry()

	// Test empty registry
	if len(registry.List()) != 0 {
		t.Errorf("Expected empty registry, got %d providers", len(registry.List()))
	}

	// Test registration
	provider := NewOpenAIProvider(OpenAIConfig{
		Name:   "test",
		APIKey: "test-key",
	})
	registry.Register("test", provider)

	if len(registry.List()) != 1 {
		t.Errorf("Expected 1 provider, got %d", len(registry.List()))
	}

	// Test retrieval
	retrieved, ok := registry.Get("test")
	if !ok {
		t.Error("Expected to find provider 'test'")
	}
	if retrieved.Name() != "test" {
		t.Errorf("Expected provider name 'test', got '%s'", retrieved.Name())
	}

	// Test case-insensitive retrieval
	retrieved2, ok := registry.Get("TEST")
	if !ok {
		t.Error("Expected case-insensitive retrieval to work")
	}
	if retrieved2.Name() != "test" {
		t.Errorf("Expected provider name 'test', got '%s'", retrieved2.Name())
	}
}

// TestCreateProvider tests provider creation
func TestCreateProvider(t *testing.T) {
	tests := []struct {
		name     string
		config   ProviderConfig
		wantErr  bool
		checkName string
	}{
		{
			name: "OpenAI",
			config: ProviderConfig{
				Type:   "openai",
				APIKey: "test-key",
			},
			wantErr:  false,
			checkName: "openai",
		},
		{
			name: "DeepSeek",
			config: ProviderConfig{
				Type:   "deepseek",
				APIKey: "test-key",
			},
			wantErr:  false,
			checkName: "deepseek",
		},
		{
			name: "Anthropic",
			config: ProviderConfig{
				Type:   "anthropic",
				APIKey: "test-key",
			},
			wantErr:  false,
			checkName: "anthropic",
		},
		{
			name: "Claude (alias)",
			config: ProviderConfig{
				Type:   "claude",
				APIKey: "test-key",
			},
			wantErr:  false,
			checkName: "claude",
		},
		{
			name: "Gemini",
			config: ProviderConfig{
				Type:   "gemini",
				APIKey: "test-key",
			},
			wantErr:  false,
			checkName: "gemini",
		},
		{
			name: "Unknown provider",
			config: ProviderConfig{
				Type:   "unknown",
				APIKey: "test-key",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider, err := CreateProvider(tt.config)
			if (err != nil) != tt.wantErr {
				t.Errorf("CreateProvider() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && provider != nil {
				if provider.Name() != tt.checkName {
					t.Errorf("CreateProvider() provider name = %v, want %v", provider.Name(), tt.checkName)
				}
			}
		})
	}
}

// TestOpenAIProvider tests OpenAI provider (without actual API calls)
func TestOpenAIProvider(t *testing.T) {
	provider := NewOpenAIProvider(OpenAIConfig{
		Name:   "test-openai",
		APIKey: "test-key",
	})

	if provider.Name() != "test-openai" {
		t.Errorf("Expected name 'test-openai', got '%s'", provider.Name())
	}

	// Test ListModels (will fail without real API, but tests the method exists)
	ctx := context.Background()
	_, err := provider.ListModels(ctx)
	// We expect an error without a real API key, but the method should exist
	if err == nil {
		t.Log("ListModels succeeded (unexpected, might have real API key)")
	}
}

// TestAnthropicProvider tests Anthropic provider
func TestAnthropicProvider(t *testing.T) {
	provider := NewAnthropicProvider(AnthropicConfig{
		Name:   "test-anthropic",
		APIKey: "test-key",
	})

	if provider.Name() != "test-anthropic" {
		t.Errorf("Expected name 'test-anthropic', got '%s'", provider.Name())
	}

	// Test ListModels
	ctx := context.Background()
	models, err := provider.ListModels(ctx)
	if err != nil {
		t.Errorf("ListModels() error = %v", err)
	}
	if len(models) == 0 {
		t.Error("Expected at least one model")
	}
}

// TestGeminiProvider tests Gemini provider
func TestGeminiProvider(t *testing.T) {
	provider := NewGeminiProvider(GeminiConfig{
		Name:   "test-gemini",
		APIKey: "test-key",
	})

	if provider.Name() != "test-gemini" {
		t.Errorf("Expected name 'test-gemini', got '%s'", provider.Name())
	}

	// Test ListModels (will fail without real API, but tests the method exists)
	ctx := context.Background()
	_, err := provider.ListModels(ctx)
	// We expect an error without a real API key, but the method should exist
	if err == nil {
		t.Log("ListModels succeeded (unexpected, might have real API key)")
	}
}

// TestEmbeddingProvider tests embedding provider interface
func TestEmbeddingProvider(t *testing.T) {
	// Test OpenAI provider implements EmbeddingProvider
	openaiProvider := NewOpenAIProvider(OpenAIConfig{
		Name:   "test",
		APIKey: "test-key",
	})

	// Check if OpenAIProvider implements EmbeddingProvider
	var _ EmbeddingProvider = (*OpenAIProvider)(nil)
	
	// Test that we can call CreateEmbedding (will fail without real API key, but tests interface)
	ctx := context.Background()
	_, err := openaiProvider.CreateEmbedding(ctx, []string{"test"}, "")
	if err == nil {
		t.Log("CreateEmbedding succeeded (unexpected, might have real API key)")
	}

	// Test Anthropic provider does NOT implement EmbeddingProvider (by design)
	// This will cause a compile error if AnthropicProvider implements EmbeddingProvider
	// var _ EmbeddingProvider = (*AnthropicProvider)(nil) // This should not compile
}

// BenchmarkProviderCreation benchmarks provider creation
func BenchmarkProviderCreation(b *testing.B) {
	config := ProviderConfig{
		Type:   "openai",
		APIKey: "test-key",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := CreateProvider(config)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// TestProviderConfigValidation tests provider config validation
func TestProviderConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		config  ProviderConfig
		wantErr bool
	}{
		{
			name: "Valid OpenAI config",
			config: ProviderConfig{
				Type:   "openai",
				APIKey: "sk-test",
			},
			wantErr: false,
		},
		{
			name: "Valid DeepSeek config",
			config: ProviderConfig{
				Type:   "deepseek",
				APIKey: "sk-test",
			},
			wantErr: false,
		},
		{
			name: "Valid Anthropic config",
			config: ProviderConfig{
				Type:   "anthropic",
				APIKey: "sk-ant-test",
			},
			wantErr: false,
		},
		{
			name: "Valid Gemini config",
			config: ProviderConfig{
				Type:   "gemini",
				APIKey: "test-key",
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := CreateProvider(tt.config)
			if (err != nil) != tt.wantErr {
				t.Errorf("CreateProvider() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

