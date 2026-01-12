package handler

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"chatee-go/commonlib/log"
	dbc "chatee-go/gen/dbc"
	"chatee-go/services/dbc_rpc/repository"
)

// ChromaHandler implements ChromaService gRPC interface
type ChromaHandler struct {
	dbc.UnimplementedChromaServiceServer
	
	repo   repository.ChromaRepository
	logger log.Logger
}

// NewChromaHandler creates a new Chroma handler
func NewChromaHandler(repo repository.ChromaRepository, logger log.Logger) *ChromaHandler {
	return &ChromaHandler{
		repo:   repo,
		logger: logger,
	}
}

// Register registers the handler with gRPC server
func (h *ChromaHandler) Register(server *grpc.Server) {
	dbc.RegisterChromaServiceServer(server, h)
}

// =============================================================================
// Collection Management
// =============================================================================

// CreateCollection creates a new collection
func (h *ChromaHandler) CreateCollection(ctx context.Context, req *dbc.CreateCollectionRequest) (*dbc.CreateCollectionResponse, error) {
	if req.GetName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	collectionID, err := h.repo.CreateCollection(ctx, req.GetName(), req.GetMetadata())
	if err != nil {
		h.logger.Error("Failed to create collection", log.String("name", req.GetName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to create collection: %v", err)
	}

	collection := &dbc.Collection{
		Name:     req.GetName(),
		Id:       collectionID,
		Metadata: req.GetMetadata(),
	}

	return &dbc.CreateCollectionResponse{Collection: collection}, nil
}

// GetCollection retrieves a collection by name
func (h *ChromaHandler) GetCollection(ctx context.Context, req *dbc.GetCollectionRequest) (*dbc.Collection, error) {
	if req.GetName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	collection, err := h.repo.GetCollection(ctx, req.GetName())
	if err != nil {
		h.logger.Error("Failed to get collection", log.String("name", req.GetName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get collection: %v", err)
	}

	return &dbc.Collection{
		Name:     collection.Name,
		Id:       collection.ID,
		Metadata: collection.Metadata,
		CreatedAt: collection.CreatedAt,
	}, nil
}

// ListCollections lists all collections
func (h *ChromaHandler) ListCollections(ctx context.Context, req *dbc.ListCollectionsRequest) (*dbc.ListCollectionsResponse, error) {
	collections, err := h.repo.ListCollections(ctx)
	if err != nil {
		h.logger.Error("Failed to list collections", log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to list collections: %v", err)
	}

	protoCollections := make([]*dbc.Collection, len(collections))
	for i, c := range collections {
		protoCollections[i] = &dbc.Collection{
			Name:     c.Name,
			Id:       c.ID,
			Metadata: c.Metadata,
			CreatedAt: c.CreatedAt,
		}
	}

	return &dbc.ListCollectionsResponse{Collections: protoCollections}, nil
}

// DeleteCollection deletes a collection
func (h *ChromaHandler) DeleteCollection(ctx context.Context, req *dbc.DeleteCollectionRequest) (*dbc.DeleteCollectionResponse, error) {
	if req.GetName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if err := h.repo.DeleteCollection(ctx, req.GetName()); err != nil {
		h.logger.Error("Failed to delete collection", log.String("name", req.GetName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete collection: %v", err)
	}

	return &dbc.DeleteCollectionResponse{Success: true}, nil
}

// =============================================================================
// Document Operations
// =============================================================================

// AddDocuments adds documents to a collection
func (h *ChromaHandler) AddDocuments(ctx context.Context, req *dbc.AddDocumentsRequest) (*dbc.AddDocumentsResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetDocuments()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one document is required")
	}

	// Convert proto documents to repository documents
	docs := make([]*repository.Document, len(req.GetDocuments()))
	for i, protoDoc := range req.GetDocuments() {
		embedding := make([]float32, len(protoDoc.GetEmbedding()))
		for j, v := range protoDoc.GetEmbedding() {
			embedding[j] = float32(v)
		}
		docs[i] = &repository.Document{
			ID:        protoDoc.GetId(),
			Embedding: embedding,
			Content:   protoDoc.GetContent(),
			Metadata:  protoDoc.GetMetadata(),
		}
	}

	ids, err := h.repo.AddDocuments(ctx, req.GetCollectionName(), docs)
	if err != nil {
		h.logger.Error("Failed to add documents", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to add documents: %v", err)
	}

	return &dbc.AddDocumentsResponse{Ids: ids, Success: true}, nil
}

// GetDocuments retrieves documents by IDs
func (h *ChromaHandler) GetDocuments(ctx context.Context, req *dbc.GetDocumentsRequest) (*dbc.GetDocumentsResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetIds()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one document ID is required")
	}

	docs, err := h.repo.GetDocuments(ctx, req.GetCollectionName(), req.GetIds(), req.GetIncludeEmbeddings())
	if err != nil {
		h.logger.Error("Failed to get documents", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get documents: %v", err)
	}

	protoDocs := make([]*dbc.Document, len(docs))
	for i, doc := range docs {
		protoDocs[i] = &dbc.Document{
			Id:        doc.ID,
			Embedding: doc.Embedding, // Already []float32
			Content:   doc.Content,
			Metadata:  doc.Metadata,
		}
	}

	return &dbc.GetDocumentsResponse{Documents: protoDocs}, nil
}

// DeleteDocuments deletes documents by IDs
func (h *ChromaHandler) DeleteDocuments(ctx context.Context, req *dbc.DeleteDocumentsRequest) (*dbc.DeleteDocumentsResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetIds()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one document ID is required")
	}

	count, err := h.repo.DeleteDocuments(ctx, req.GetCollectionName(), req.GetIds())
	if err != nil {
		h.logger.Error("Failed to delete documents", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to delete documents: %v", err)
	}

	return &dbc.DeleteDocumentsResponse{Success: true, DeletedCount: count}, nil
}

// UpdateDocuments updates documents in a collection
func (h *ChromaHandler) UpdateDocuments(ctx context.Context, req *dbc.UpdateDocumentsRequest) (*dbc.UpdateDocumentsResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetDocuments()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one document is required")
	}

	// Convert proto documents to repository documents
	docs := make([]*repository.Document, len(req.GetDocuments()))
	for i, protoDoc := range req.GetDocuments() {
		embedding := make([]float32, len(protoDoc.GetEmbedding()))
		for j, v := range protoDoc.GetEmbedding() {
			embedding[j] = float32(v)
		}
		docs[i] = &repository.Document{
			ID:        protoDoc.GetId(),
			Embedding: embedding,
			Content:   protoDoc.GetContent(),
			Metadata:  protoDoc.GetMetadata(),
		}
	}

	if err := h.repo.UpdateDocuments(ctx, req.GetCollectionName(), docs); err != nil {
		h.logger.Error("Failed to update documents", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to update documents: %v", err)
	}

	return &dbc.UpdateDocumentsResponse{Success: true}, nil
}

// =============================================================================
// Query Operations (RAG)
// =============================================================================

// Query performs a vector similarity search
func (h *ChromaHandler) Query(ctx context.Context, req *dbc.QueryRequest) (*dbc.QueryResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetQueryEmbeddings()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one query embedding is required")
	}

	// Convert query embeddings
	queryEmbeddings := make([][]float32, 1) // ChromaDB expects array of arrays
	embedding := make([]float32, len(req.GetQueryEmbeddings()))
	for i, v := range req.GetQueryEmbeddings() {
		embedding[i] = float32(v)
	}
	queryEmbeddings[0] = embedding

	nResults := int(req.GetNResults())
	if nResults <= 0 {
		nResults = 10 // Default
	}

	include := req.GetInclude()
	if len(include) == 0 {
		include = []string{"documents", "metadatas", "distances"}
	}

	results, err := h.repo.Query(ctx, req.GetCollectionName(), queryEmbeddings, nResults, req.GetWhere(), include)
	if err != nil {
		h.logger.Error("Failed to query documents", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to query documents: %v", err)
	}

	// Convert to proto format
	protoResults := make([]*dbc.QueryResult, len(results))
	for i, result := range results {
		embeddings := make([]*dbc.EmbeddingVector, len(result.Embeddings))
		for j, emb := range result.Embeddings {
			embeddings[j] = &dbc.EmbeddingVector{Values: emb} // Already []float32
		}

		metadatas := make([]*dbc.Metadata, len(result.Metadatas))
		for j, meta := range result.Metadatas {
			metadatas[j] = &dbc.Metadata{Fields: meta}
		}

		protoResults[i] = &dbc.QueryResult{
			Ids:        result.IDs,
			Embeddings: embeddings,
			Documents:  result.Documents,
			Distances:  result.Distances, // Already []float32
			Metadatas:  metadatas,
		}
	}

	return &dbc.QueryResponse{Results: protoResults}, nil
}

// QueryByIDs retrieves documents by IDs with optional includes
func (h *ChromaHandler) QueryByIDs(ctx context.Context, req *dbc.QueryByIDsRequest) (*dbc.QueryByIDsResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetIds()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one document ID is required")
	}

	include := req.GetInclude()

	docs, err := h.repo.QueryByIDs(ctx, req.GetCollectionName(), req.GetIds(), include)
	if err != nil {
		h.logger.Error("Failed to query documents by IDs", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to query documents by IDs: %v", err)
	}

	protoDocs := make([]*dbc.Document, len(docs))
	for i, doc := range docs {
		protoDocs[i] = &dbc.Document{
			Id:        doc.ID,
			Embedding: doc.Embedding, // Already []float32
			Content:   doc.Content,
			Metadata:  doc.Metadata,
		}
	}

	return &dbc.QueryByIDsResponse{Documents: protoDocs}, nil
}

// =============================================================================
// Embedding Operations
// =============================================================================

// GetEmbeddings retrieves embeddings for given IDs
func (h *ChromaHandler) GetEmbeddings(ctx context.Context, req *dbc.GetEmbeddingsRequest) (*dbc.GetEmbeddingsResponse, error) {
	if req.GetCollectionName() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "collection name is required")
	}

	if len(req.GetIds()) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one document ID is required")
	}

	embeddings, err := h.repo.GetEmbeddings(ctx, req.GetCollectionName(), req.GetIds())
	if err != nil {
		h.logger.Error("Failed to get embeddings", log.String("collection", req.GetCollectionName()), log.Err(err))
		return nil, status.Errorf(codes.Internal, "failed to get embeddings: %v", err)
	}

	protoEmbeddings := make([]*dbc.EmbeddingItem, len(embeddings))
	for i, emb := range embeddings {
		protoEmbeddings[i] = &dbc.EmbeddingItem{
			Id:     emb.ID,
			Values: emb.Embedding, // Already []float32
		}
	}

	return &dbc.GetEmbeddingsResponse{Embeddings: protoEmbeddings}, nil
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

