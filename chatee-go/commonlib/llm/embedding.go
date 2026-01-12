package llm

import (
	"context"
)

// EmbeddingProvider is an interface for providers that support embeddings.
type EmbeddingProvider interface {
	// CreateEmbedding creates embeddings for the given texts.
	CreateEmbedding(ctx context.Context, texts []string, model string) (*EmbeddingResponse, error)
}

// EmbeddingResponse represents an embedding response.
type EmbeddingResponse struct {
	Model     string       `json:"model"`
	Embeddings [][]float32 `json:"embeddings"` // One embedding vector per input text
	Usage     Usage        `json:"usage"`
}

// EmbeddingRequest represents an embedding request.
type EmbeddingRequest struct {
	Model string   `json:"model"`
	Texts []string `json:"texts"`
}

