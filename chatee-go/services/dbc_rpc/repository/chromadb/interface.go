package repository

import (
	"context"
)

// =============================================================================
// Chroma Repository Interface
// =============================================================================

// ChromaRepository provides ChromaDB vector database operations
type ChromaRepository interface {
	// Collection Management
	CreateCollection(ctx context.Context, name string, metadata map[string]string) (string, error)
	GetCollection(ctx context.Context, name string) (*Collection, error)
	ListCollections(ctx context.Context) ([]*Collection, error)
	DeleteCollection(ctx context.Context, name string) error

	// Document Operations
	AddDocuments(ctx context.Context, collectionName string, documents []*Document) ([]string, error)
	GetDocuments(ctx context.Context, collectionName string, ids []string, includeEmbeddings bool) ([]*Document, error)
	DeleteDocuments(ctx context.Context, collectionName string, ids []string) (int64, error)
	UpdateDocuments(ctx context.Context, collectionName string, documents []*Document) error

	// Query Operations (RAG)
	Query(ctx context.Context, collectionName string, queryEmbeddings [][]float32, nResults int, where map[string]string, include []string) ([]*QueryResult, error)
	QueryByIDs(ctx context.Context, collectionName string, ids []string, include []string) ([]*Document, error)

	// Embedding Operations
	GetEmbeddings(ctx context.Context, collectionName string, ids []string) ([]*EmbeddingItem, error)
}

// =============================================================================
// Chroma Data Structures
// =============================================================================

// Collection represents a ChromaDB collection
type Collection struct {
	Name      string
	ID        string
	Metadata  map[string]string
	CreatedAt int64
}

// Document represents a document in ChromaDB
type Document struct {
	ID        string
	Embedding []float32
	Content   string
	Metadata  map[string]string
}

// QueryResult represents a query result from ChromaDB
type QueryResult struct {
	IDs        []string
	Embeddings [][]float32
	Documents  []string
	Distances  []float32
	Metadatas  []map[string]string
}

// EmbeddingItem represents an embedding with its ID
type EmbeddingItem struct {
	ID        string
	Embedding []float32
}
