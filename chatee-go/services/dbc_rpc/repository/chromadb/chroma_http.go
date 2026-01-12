package chromadb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"chatee-go/commonlib/log"
)

// HTTPChromaRepository implements ChromaRepository using HTTP API
type HTTPChromaRepository struct {
	baseURL    string
	httpClient *http.Client
	logger     log.Logger
}

// NewHTTPChromaRepository creates a new HTTP-based ChromaDB repository
func NewHTTPChromaRepository(host string, port int, logger log.Logger) HTTPChromaRepository {
	baseURL := fmt.Sprintf("http://%s:%d/api/v1", host, port)

	return HTTPChromaRepository{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger: logger,
	}
}

// =============================================================================
// Helper Methods
// =============================================================================

func (r *HTTPChromaRepository) doRequest(ctx context.Context, method, endpoint string, body interface{}) (*http.Response, error) {
	var reqBody io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonData)
	}

	url := r.baseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}

	return resp, nil
}

func (r *HTTPChromaRepository) parseResponse(resp *http.Response, result interface{}) error {
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("failed to decode response: %w", err)
		}
	}

	return nil
}

// =============================================================================
// Collection Management
// =============================================================================

// CreateCollection creates a new collection in ChromaDB
func (r *HTTPChromaRepository) CreateCollection(ctx context.Context, name string, metadata map[string]string) (string, error) {
	reqBody := map[string]interface{}{
		"name":     name,
		"metadata": metadata,
	}

	resp, err := r.doRequest(ctx, "POST", "/collections", reqBody)
	if err != nil {
		return "", err
	}

	var result struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return "", err
	}

	return result.ID, nil
}

// GetCollection retrieves a collection by name
func (r *HTTPChromaRepository) GetCollection(ctx context.Context, name string) (*Collection, error) {
	resp, err := r.doRequest(ctx, "GET", fmt.Sprintf("/collections/%s", name), nil)
	if err != nil {
		return nil, err
	}

	var result struct {
		ID        string            `json:"id"`
		Name      string            `json:"name"`
		Metadata  map[string]string `json:"metadata"`
		CreatedAt int64             `json:"created_at"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return nil, err
	}

	return &Collection{
		ID:        result.ID,
		Name:      result.Name,
		Metadata:  result.Metadata,
		CreatedAt: result.CreatedAt,
	}, nil
}

// ListCollections lists all collections
func (r *HTTPChromaRepository) ListCollections(ctx context.Context) ([]*Collection, error) {
	resp, err := r.doRequest(ctx, "GET", "/collections", nil)
	if err != nil {
		return nil, err
	}

	var result []struct {
		ID        string            `json:"id"`
		Name      string            `json:"name"`
		Metadata  map[string]string `json:"metadata"`
		CreatedAt int64             `json:"created_at"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return nil, err
	}

	collections := make([]*Collection, len(result))
	for i, c := range result {
		collections[i] = &Collection{
			ID:        c.ID,
			Name:      c.Name,
			Metadata:  c.Metadata,
			CreatedAt: c.CreatedAt,
		}
	}

	return collections, nil
}

// DeleteCollection deletes a collection
func (r *HTTPChromaRepository) DeleteCollection(ctx context.Context, name string) error {
	resp, err := r.doRequest(ctx, "DELETE", fmt.Sprintf("/collections/%s", name), nil)
	if err != nil {
		return err
	}

	return r.parseResponse(resp, nil)
}

// =============================================================================
// Document Operations
// =============================================================================

// AddDocuments adds documents to a collection
func (r *HTTPChromaRepository) AddDocuments(ctx context.Context, collectionName string, documents []*Document) ([]string, error) {
	ids := make([]string, len(documents))
	embeddings := make([][]float32, len(documents))
	contents := make([]string, len(documents))
	metadatas := make([]map[string]string, len(documents))

	for i, doc := range documents {
		ids[i] = doc.ID
		embeddings[i] = doc.Embedding
		contents[i] = doc.Content
		metadatas[i] = doc.Metadata
	}

	reqBody := map[string]interface{}{
		"ids":        ids,
		"embeddings": embeddings,
		"documents":  contents,
		"metadatas":  metadatas,
	}

	resp, err := r.doRequest(ctx, "POST", fmt.Sprintf("/collections/%s/add", collectionName), reqBody)
	if err != nil {
		return nil, err
	}

	var result struct {
		IDs []string `json:"ids"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return nil, err
	}

	return result.IDs, nil
}

// GetDocuments retrieves documents by IDs
func (r *HTTPChromaRepository) GetDocuments(ctx context.Context, collectionName string, ids []string, includeEmbeddings bool) ([]*Document, error) {
	reqBody := map[string]interface{}{
		"ids":     ids,
		"include": []string{"documents", "metadatas"},
	}

	if includeEmbeddings {
		reqBody["include"] = []string{"documents", "metadatas", "embeddings"}
	}

	resp, err := r.doRequest(ctx, "POST", fmt.Sprintf("/collections/%s/get", collectionName), reqBody)
	if err != nil {
		return nil, err
	}

	var result struct {
		IDs        []string            `json:"ids"`
		Embeddings [][]float32         `json:"embeddings,omitempty"`
		Documents  []string            `json:"documents"`
		Metadatas  []map[string]string `json:"metadatas"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return nil, err
	}

	documents := make([]*Document, len(result.IDs))
	for i := range result.IDs {
		doc := &Document{
			ID:       result.IDs[i],
			Content:  result.Documents[i],
			Metadata: result.Metadatas[i],
		}
		if includeEmbeddings && i < len(result.Embeddings) {
			doc.Embedding = result.Embeddings[i]
		}
		documents[i] = doc
	}

	return documents, nil
}

// DeleteDocuments deletes documents by IDs
func (r *HTTPChromaRepository) DeleteDocuments(ctx context.Context, collectionName string, ids []string) (int64, error) {
	reqBody := map[string]interface{}{
		"ids": ids,
	}

	resp, err := r.doRequest(ctx, "POST", fmt.Sprintf("/collections/%s/delete", collectionName), reqBody)
	if err != nil {
		return 0, err
	}

	var result struct {
		Count int64 `json:"count"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return 0, err
	}

	return result.Count, nil
}

// UpdateDocuments updates documents in a collection
func (r *HTTPChromaRepository) UpdateDocuments(ctx context.Context, collectionName string, documents []*Document) error {
	ids := make([]string, len(documents))
	embeddings := make([][]float32, len(documents))
	contents := make([]string, len(documents))
	metadatas := make([]map[string]string, len(documents))

	for i, doc := range documents {
		ids[i] = doc.ID
		embeddings[i] = doc.Embedding
		contents[i] = doc.Content
		metadatas[i] = doc.Metadata
	}

	reqBody := map[string]interface{}{
		"ids":        ids,
		"embeddings": embeddings,
		"documents":  contents,
		"metadatas":  metadatas,
	}

	resp, err := r.doRequest(ctx, "POST", fmt.Sprintf("/collections/%s/update", collectionName), reqBody)
	if err != nil {
		return err
	}

	return r.parseResponse(resp, nil)
}

// =============================================================================
// Query Operations (RAG)
// =============================================================================

// Query performs a vector similarity search
func (r *HTTPChromaRepository) Query(ctx context.Context, collectionName string, queryEmbeddings [][]float32, nResults int, where map[string]string, include []string) ([]*QueryResult, error) {
	reqBody := map[string]interface{}{
		"query_embeddings": queryEmbeddings,
		"n_results":        nResults,
	}

	if where != nil {
		reqBody["where"] = where
	}
	if include != nil {
		reqBody["include"] = include
	} else {
		reqBody["include"] = []string{"documents", "metadatas", "distances"}
	}

	resp, err := r.doRequest(ctx, "POST", fmt.Sprintf("/collections/%s/query", collectionName), reqBody)
	if err != nil {
		return nil, err
	}

	var result struct {
		IDs        [][]string            `json:"ids"`
		Embeddings [][][]float32         `json:"embeddings,omitempty"`
		Documents  [][]string            `json:"documents"`
		Distances  [][]float32           `json:"distances"`
		Metadatas  [][]map[string]string `json:"metadatas"`
	}
	if err := r.parseResponse(resp, &result); err != nil {
		return nil, err
	}

	// Convert to QueryResult format (one result per query embedding)
	queryResults := make([]*QueryResult, len(result.IDs))
	for i := range result.IDs {
		queryResults[i] = &QueryResult{
			IDs:        result.IDs[i],
			Embeddings: result.Embeddings[i],
			Documents:  result.Documents[i],
			Distances:  result.Distances[i],
			Metadatas:  result.Metadatas[i],
		}
	}

	return queryResults, nil
}

// QueryByIDs retrieves documents by IDs with optional includes
func (r *HTTPChromaRepository) QueryByIDs(ctx context.Context, collectionName string, ids []string, include []string) ([]*Document, error) {
	return r.GetDocuments(ctx, collectionName, ids, len(include) > 0 && contains(include, "embeddings"))
}

// =============================================================================
// Embedding Operations
// =============================================================================

// GetEmbeddings retrieves embeddings for given IDs
func (r *HTTPChromaRepository) GetEmbeddings(ctx context.Context, collectionName string, ids []string) ([]*EmbeddingItem, error) {
	documents, err := r.GetDocuments(ctx, collectionName, ids, true)
	if err != nil {
		return nil, err
	}

	embeddings := make([]*EmbeddingItem, len(documents))
	for i, doc := range documents {
		embeddings[i] = &EmbeddingItem{
			ID:        doc.ID,
			Embedding: doc.Embedding,
		}
	}

	return embeddings, nil
}

// =============================================================================
// Helper Functions
// =============================================================================

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
