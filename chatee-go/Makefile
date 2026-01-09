.PHONY: all build clean proto test lint fmt deps \
	run-dbc run-http run-conn run-svr run-msg \
	start stop restart status \
	deploy deploy-down deploy-logs deploy-ps \
	docker-build docker-up docker-down docker-logs \
	migrate-up migrate-down init help

# Variables
GO := go
PROTOC := protoc
BUILD_DIR := bin
PROTO_DIR := proto
GEN_DIR := gen
SERVICES := dbc_rpc chatee_http conn_rpc svr_rpc im_rpc
DOCKER_COMPOSE := docker-compose -f deployments/docker/docker-compose.yaml
PID_DIR := .pids

# Colors for output
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m

# Default target
all: proto build

# =============================================================================
# Build
# =============================================================================

# Build all services
build:
	@echo "$(GREEN)Building all services...$(NC)"
	@mkdir -p $(BUILD_DIR)
	@for svc in $(SERVICES); do \
		echo "Building $$svc..."; \
		if [ -d "./services/$$svc/cmd" ]; then \
			$(GO) build -o $(BUILD_DIR)/$$svc ./services/$$svc/cmd || exit 1; \
		else \
			$(GO) build -o $(BUILD_DIR)/$$svc ./services/$$svc || exit 1; \
		fi \
	done
	@echo "$(GREEN)Build complete!$(NC)"

# Build individual services
build-dbc:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/dbc_rpc ./services/dbc_rpc

build-http:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/chatee_http ./services/chatee_http

build-conn:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/conn_rpc ./services/conn_rpc

build-svr:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/svr_rpc ./services/svr_rpc/cmd

build-msg:
	@mkdir -p $(BUILD_DIR)
	$(GO) build -o $(BUILD_DIR)/im_rpc ./services/im_rpc/cmd

# Clean build artifacts
clean:
	@echo "$(YELLOW)Cleaning...$(NC)"
	@rm -rf $(BUILD_DIR)
	@rm -rf $(GEN_DIR)
	@rm -rf $(PID_DIR)
	@echo "$(GREEN)Clean complete!$(NC)"

# =============================================================================
# Protobuf Generation
# =============================================================================

# Generate protobuf files
proto: proto-check proto-gen

proto-check:
	@echo "$(GREEN)Checking protoc installation...$(NC)"
	@which protoc > /dev/null || (echo "$(RED)protoc not found. Install with: brew install protobuf$(NC)" && exit 1)
	@which protoc-gen-go > /dev/null || (echo "$(YELLOW)Installing protoc-gen-go...$(NC)" && go install google.golang.org/protobuf/cmd/protoc-gen-go@latest)
	@which protoc-gen-go-grpc > /dev/null || (echo "$(YELLOW)Installing protoc-gen-go-grpc...$(NC)" && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest)
	@echo "$(GREEN)Protoc tools ready!$(NC)"

proto-gen:
	@echo "$(GREEN)Generating protobuf files...$(NC)"
	@mkdir -p $(GEN_DIR)
	@# Generate common proto (special case, no domain.proto)
	@if [ -d "$(PROTO_DIR)/common" ]; then \
		echo "Processing common protos..."; \
		$(PROTOC) -I$(PROTO_DIR) \
			--go_out=$(GEN_DIR) --go_opt=paths=source_relative \
			--go-grpc_out=$(GEN_DIR) --go-grpc_opt=paths=source_relative \
			$(PROTO_DIR)/common/*.proto; \
	fi
	@# Generate all domain protos (process all proto files in each domain directory)
	@for domain_dir in $(PROTO_DIR)/*/; do \
		domain=$$(basename "$$domain_dir"); \
		if [ "$$domain" = "common" ]; then continue; fi; \
		echo "Processing $$domain protos..."; \
		$(PROTOC) -I$(PROTO_DIR) \
			--go_out=$(GEN_DIR) --go_opt=paths=source_relative \
			--go-grpc_out=$(GEN_DIR) --go-grpc_opt=paths=source_relative \
			$$domain_dir*.proto; \
	done
	@echo "$(GREEN)Protobuf generation complete!$(NC)"
	@echo "Generated files in $(GEN_DIR)/"
	@find $(GEN_DIR) -name "*.go" 2>/dev/null | head -20 || echo "No proto files found to generate"

# =============================================================================
# Testing & Linting
# =============================================================================

# Run tests
test:
	@echo "$(GREEN)Running tests...$(NC)"
	$(GO) test -v -race -cover ./...

# Run tests with coverage
test-coverage:
	@echo "$(GREEN)Running tests with coverage...$(NC)"
	$(GO) test -v -race -coverprofile=coverage.out ./...
	$(GO) tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

# Lint code
lint:
	@echo "$(GREEN)Linting...$(NC)"
	@which golangci-lint > /dev/null || (echo "$(YELLOW)Installing golangci-lint...$(NC)" && brew install golangci-lint)
	golangci-lint run ./...

# Format code
fmt:
	@echo "$(GREEN)Formatting...$(NC)"
	$(GO) fmt ./...
	@which goimports > /dev/null && goimports -w . || echo "goimports not installed, skipping"

# Download dependencies
deps:
	@echo "$(GREEN)Downloading dependencies...$(NC)"
	$(GO) mod download
	$(GO) mod tidy
	@echo "$(GREEN)Dependencies ready!$(NC)"

# =============================================================================
# Local Development - Start/Stop Services
# =============================================================================

# Start all services locally (foreground with tmux or background)
start: build
	@echo "$(GREEN)Starting all services locally...$(NC)"
	@mkdir -p $(PID_DIR)
	@# Start DBC first
	@echo "Starting dbc_rpc..."
	@$(BUILD_DIR)/dbc_rpc > logs/dbc.log 2>&1 & echo $$! > $(PID_DIR)/dbc.pid
	@sleep 2
	@# Start IM
	@echo "Starting im_rpc..."
	@$(BUILD_DIR)/im_rpc > logs/im.log 2>&1 & echo $$! > $(PID_DIR)/im.pid
	@sleep 1
	@# Start SVR
	@echo "Starting svr_rpc..."
	@$(BUILD_DIR)/svr_rpc > logs/svr.log 2>&1 & echo $$! > $(PID_DIR)/svr.pid
	@sleep 1
	@# Start CONN
	@echo "Starting conn_rpc..."
	@$(BUILD_DIR)/conn_rpc > logs/conn.log 2>&1 & echo $$! > $(PID_DIR)/conn.pid
	@sleep 1
	@# Start HTTP
	@echo "Starting chatee_http..."
	@$(BUILD_DIR)/chatee_http > logs/http.log 2>&1 & echo $$! > $(PID_DIR)/http.pid
	@sleep 1
	@echo ""
	@echo "$(GREEN)All services started!$(NC)"
	@echo "Services:"
	@echo "  - dbc_rpc:     gRPC :9091"
	@echo "  - im_rpc:      gRPC :9093"
	@echo "  - svr_rpc:     gRPC :9092"
	@echo "  - conn_rpc:    WS   :8081"
	@echo "  - chatee_http: HTTP :8080"
	@echo ""
	@echo "Logs: logs/*.log"
	@echo "PIDs: $(PID_DIR)/*.pid"
	@echo ""
	@echo "Use 'make status' to check service status"
	@echo "Use 'make stop' to stop all services"

# Stop all services
stop:
	@echo "$(YELLOW)Stopping all services...$(NC)"
	@if [ -f $(PID_DIR)/http.pid ]; then kill $$(cat $(PID_DIR)/http.pid) 2>/dev/null || true; rm -f $(PID_DIR)/http.pid; fi
	@if [ -f $(PID_DIR)/conn.pid ]; then kill $$(cat $(PID_DIR)/conn.pid) 2>/dev/null || true; rm -f $(PID_DIR)/conn.pid; fi
	@if [ -f $(PID_DIR)/svr.pid ]; then kill $$(cat $(PID_DIR)/svr.pid) 2>/dev/null || true; rm -f $(PID_DIR)/svr.pid; fi
	@if [ -f $(PID_DIR)/im.pid ]; then kill $$(cat $(PID_DIR)/im.pid) 2>/dev/null || true; rm -f $(PID_DIR)/im.pid; fi
	@if [ -f $(PID_DIR)/dbc.pid ]; then kill $$(cat $(PID_DIR)/dbc.pid) 2>/dev/null || true; rm -f $(PID_DIR)/dbc.pid; fi
	@# Also kill any remaining processes
	@pkill -f "dbc_rpc\|im_rpc\|svr_rpc\|conn_rpc\|chatee_http" 2>/dev/null || true
	@echo "$(GREEN)All services stopped!$(NC)"

# Restart all services
restart: stop start

# Check service status
status:
	@echo "$(GREEN)Service Status:$(NC)"
	@echo ""
	@echo "PID Files:"
	@for svc in dbc im svr conn http; do \
		svc_name=$$(case $$svc in dbc) echo "dbc_rpc" ;; im) echo "im_rpc" ;; svr) echo "svr_rpc" ;; conn) echo "conn_rpc" ;; http) echo "chatee_http" ;; esac); \
		if [ -f $(PID_DIR)/$$svc.pid ]; then \
			pid=$$(cat $(PID_DIR)/$$svc.pid); \
			if ps -p $$pid > /dev/null 2>&1; then \
				echo "  ✓ $$svc_name (PID: $$pid) - $(GREEN)Running$(NC)"; \
			else \
				echo "  ✗ $$svc_name (PID: $$pid) - $(RED)Not Running$(NC)"; \
			fi \
		else \
			echo "  ✗ $$svc_name - $(RED)Not Started$(NC)"; \
		fi \
	done
	@echo ""
	@echo "Ports:"
	@lsof -i :8080 2>/dev/null | grep LISTEN | head -1 || echo "  8080 (HTTP): Not listening"
	@lsof -i :8081 2>/dev/null | grep LISTEN | head -1 || echo "  8081 (WS):   Not listening"
	@lsof -i :9091 2>/dev/null | grep LISTEN | head -1 || echo "  9091 (DBC):  Not listening"
	@lsof -i :9092 2>/dev/null | grep LISTEN | head -1 || echo "  9092 (SVR):  Not listening"
	@lsof -i :9093 2>/dev/null | grep LISTEN | head -1 || echo "  9093 (IM):   Not listening"

# View logs
logs:
	@echo "$(GREEN)Recent logs:$(NC)"
	@tail -f logs/*.log

# Run individual services (foreground for development)
run-dbc:
	$(GO) run ./services/dbc_rpc

run-http:
	$(GO) run ./services/chatee_http

run-conn:
	$(GO) run ./services/conn_rpc

run-svr:
	$(GO) run ./services/svr_rpc/cmd

run-msg:
	$(GO) run ./services/im_rpc/cmd

# =============================================================================
# Docker Compose Deployment
# =============================================================================

# Deploy all services using Docker Compose
deploy:
	@echo "$(GREEN)Deploying with Docker Compose...$(NC)"
	@if [ ! -f deployments/docker/.env ]; then \
		echo "$(YELLOW)Creating .env from template...$(NC)"; \
		cp deployments/docker/.env.example deployments/docker/.env; \
		echo "$(RED)Please edit deployments/docker/.env with your API keys!$(NC)"; \
	fi
	$(DOCKER_COMPOSE) up -d --build
	@echo ""
	@echo "$(GREEN)Deployment complete!$(NC)"
	@echo ""
	@$(DOCKER_COMPOSE) ps
	@echo ""
	@echo "Services:"
	@echo "  - API:       http://localhost:8080"
	@echo "  - WebSocket: ws://localhost:8081"
	@echo "  - MySQL:     localhost:3306"
	@echo "  - Redis:     localhost:6379"
	@echo ""
	@echo "Use 'make deploy-logs' to view logs"
	@echo "Use 'make deploy-down' to stop"

# Stop Docker deployment
deploy-down:
	@echo "$(YELLOW)Stopping Docker deployment...$(NC)"
	$(DOCKER_COMPOSE) down
	@echo "$(GREEN)Deployment stopped!$(NC)"

# View Docker deployment logs
deploy-logs:
	$(DOCKER_COMPOSE) logs -f

# Show Docker deployment status
deploy-ps:
	$(DOCKER_COMPOSE) ps

# Restart Docker deployment
deploy-restart:
	@echo "$(YELLOW)Restarting Docker deployment...$(NC)"
	$(DOCKER_COMPOSE) restart
	@echo "$(GREEN)Deployment restarted!$(NC)"

# Rebuild and redeploy
deploy-rebuild:
	@echo "$(GREEN)Rebuilding and redeploying...$(NC)"
	$(DOCKER_COMPOSE) up -d --build --force-recreate

# Clean Docker resources
deploy-clean:
	@echo "$(YELLOW)Cleaning Docker resources...$(NC)"
	$(DOCKER_COMPOSE) down -v --rmi local
	@echo "$(GREEN)Docker resources cleaned!$(NC)"

# Legacy docker commands (for backwards compatibility)
docker-build:
	@echo "$(GREEN)Building Docker images...$(NC)"
	$(DOCKER_COMPOSE) build

docker-up:
	@echo "$(GREEN)Starting Docker containers...$(NC)"
	$(DOCKER_COMPOSE) up -d

docker-down:
	@echo "$(YELLOW)Stopping Docker containers...$(NC)"
	$(DOCKER_COMPOSE) down

docker-logs:
	$(DOCKER_COMPOSE) logs -f

# =============================================================================
# Database
# =============================================================================

# Database migrations
migrate-up:
	@echo "$(GREEN)Running migrations...$(NC)"
	mysql -h localhost -u root chatee < migrations/mysql/001_initial_schema.sql
	@echo "$(GREEN)Migrations complete!$(NC)"

migrate-down:
	@echo "$(YELLOW)Rolling back migrations...$(NC)"
	@echo "$(RED)Not implemented - please manually drop tables$(NC)"

# =============================================================================
# Development Environment Setup
# =============================================================================

# Initialize development environment
init: deps
	@echo "$(GREEN)Initializing development environment...$(NC)"
	@mkdir -p $(BUILD_DIR)
	@mkdir -p logs
	@mkdir -p $(PID_DIR)
	@mkdir -p $(GEN_DIR)
	@echo "Creating database..."
	mysql -h localhost -u root -e "CREATE DATABASE IF NOT EXISTS chatee CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" || echo "$(YELLOW)Could not create database - MySQL may not be running$(NC)"
	@echo "Running migrations..."
	mysql -h localhost -u root chatee < migrations/mysql/001_initial_schema.sql || echo "$(YELLOW)Could not run migrations$(NC)"
	@echo "$(GREEN)Development environment ready!$(NC)"
	@echo ""
	@echo "Next steps:"
	@echo "  1. make proto  - Generate protobuf files"
	@echo "  2. make build  - Build all services"
	@echo "  3. make start  - Start all services"
	@echo "  Or use Docker:"
	@echo "  1. make deploy - Deploy with Docker Compose"

# =============================================================================
# Help
# =============================================================================

help:
	@echo "$(GREEN)Chatee Backend Makefile$(NC)"
	@echo ""
	@echo "$(YELLOW)Build Commands:$(NC)"
	@echo "  make all          - Generate protos and build all services"
	@echo "  make build        - Build all services"
	@echo "  make build-xxx    - Build specific service (dbc, http, conn, svr, msg)"
	@echo "  make clean        - Clean build artifacts"
	@echo ""
	@echo "$(YELLOW)Protobuf Commands:$(NC)"
	@echo "  make proto        - Generate protobuf files (installs tools if needed)"
	@echo "  make proto-check  - Check protoc installation"
	@echo ""
	@echo "$(YELLOW)Local Development:$(NC)"
	@echo "  make start        - Build and start all services (background)"
	@echo "  make stop         - Stop all services"
	@echo "  make restart      - Restart all services"
	@echo "  make status       - Check service status"
	@echo "  make logs         - View service logs"
	@echo "  make run-xxx      - Run specific service (foreground)"
	@echo ""
	@echo "$(YELLOW)Docker Deployment:$(NC)"
	@echo "  make deploy       - Deploy all services with Docker Compose"
	@echo "  make deploy-down  - Stop Docker deployment"
	@echo "  make deploy-logs  - View Docker logs"
	@echo "  make deploy-ps    - Show Docker container status"
	@echo "  make deploy-restart - Restart Docker deployment"
	@echo "  make deploy-rebuild - Rebuild and redeploy"
	@echo "  make deploy-clean - Remove Docker resources and volumes"
	@echo ""
	@echo "$(YELLOW)Testing & Quality:$(NC)"
	@echo "  make test         - Run tests"
	@echo "  make test-coverage - Run tests with coverage report"
	@echo "  make lint         - Lint code"
	@echo "  make fmt          - Format code"
	@echo ""
	@echo "$(YELLOW)Database:$(NC)"
	@echo "  make migrate-up   - Run database migrations"
	@echo ""
	@echo "$(YELLOW)Setup:$(NC)"
	@echo "  make init         - Initialize development environment"
	@echo "  make deps         - Download Go dependencies"
	@echo ""
	@echo "$(YELLOW)Quick Start:$(NC)"
	@echo "  Local:  make init && make proto && make start"
	@echo "  Docker: make deploy"
