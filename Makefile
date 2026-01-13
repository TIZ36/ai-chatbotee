# =============================================================================
# Chatee Project - Root Makefile
# =============================================================================
# This Makefile provides commands to manage all sub-projects:
#   - backend (Python Flask)
#   - chatee-go (Go microservices)
#   - front (Vue/React frontend)
#   - new-chatee-front (Next.js frontend)
# =============================================================================

.PHONY: all clean clean-all help \
	clean-backend clean-frontend clean-go clean-nextjs \
	install install-all

# Colors
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m

# Default target
all: help

# =============================================================================
# Clean Commands
# =============================================================================

# Clean all build artifacts and dependencies
clean: clean-backend clean-frontend clean-go clean-nextjs clean-root
	@echo "$(GREEN)All projects cleaned!$(NC)"

# Alias for clean
clean-all: clean

# Clean Python backend
clean-backend:
	@echo "$(YELLOW)Cleaning Python backend...$(NC)"
	@find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find backend -type f -name "*.pyc" -delete 2>/dev/null || true
	@find backend -type f -name "*.pyo" -delete 2>/dev/null || true
	@find backend -type f -name "*.pyd" -delete 2>/dev/null || true
	@find backend -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	@find backend -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	@find backend -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	@rm -rf backend/venv backend/.venv backend/env 2>/dev/null || true
	@rm -rf backend/logs 2>/dev/null || true
	@echo "$(GREEN)Python backend cleaned!$(NC)"

# Clean Vue/React frontend
clean-frontend:
	@echo "$(YELLOW)Cleaning frontend (front/)...$(NC)"
	@rm -rf front/node_modules 2>/dev/null || true
	@rm -rf front/dist 2>/dev/null || true
	@rm -rf front/.next 2>/dev/null || true
	@rm -rf front/build 2>/dev/null || true
	@rm -rf front/.cache 2>/dev/null || true
	@echo "$(GREEN)Frontend cleaned!$(NC)"

# Clean Go backend
clean-go:
	@echo "$(YELLOW)Cleaning Go backend (chatee-go/)...$(NC)"
	@rm -rf chatee-go/bin 2>/dev/null || true
	@rm -rf chatee-go/gen 2>/dev/null || true
	@rm -rf chatee-go/logs 2>/dev/null || true
	@rm -rf chatee-go/.pids 2>/dev/null || true
	@rm -rf chatee-go/coverage.out chatee-go/coverage.html 2>/dev/null || true
	@rm -rf chatee-go/conn_rpc 2>/dev/null || true
	@rm -rf chatee-go/.cursor 2>/dev/null || true
	@echo "$(GREEN)Go backend cleaned!$(NC)"

# Clean Next.js frontend
clean-nextjs:
	@echo "$(YELLOW)Cleaning Next.js frontend (new-chatee-front/)...$(NC)"
	@rm -rf new-chatee-front/node_modules 2>/dev/null || true
	@rm -rf new-chatee-front/.next 2>/dev/null || true
	@rm -rf new-chatee-front/out 2>/dev/null || true
	@rm -rf new-chatee-front/build 2>/dev/null || true
	@rm -rf new-chatee-front/.cache 2>/dev/null || true
	@echo "$(GREEN)Next.js frontend cleaned!$(NC)"

# Clean root level artifacts
clean-root:
	@echo "$(YELLOW)Cleaning root level artifacts...$(NC)"
	@rm -rf node_modules 2>/dev/null || true
	@rm -rf dist 2>/dev/null || true
	@rm -rf dist-electron 2>/dev/null || true
	@rm -rf .next 2>/dev/null || true
	@rm -rf .cache 2>/dev/null || true
	@rm -rf .cursor 2>/dev/null || true
	@find . -maxdepth 1 -name "*.log" -delete 2>/dev/null || true
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@echo "$(GREEN)Root level cleaned!$(NC)"

# =============================================================================
# Install Commands
# =============================================================================

# Install all dependencies
install-all: install-backend install-frontend install-go install-nextjs
	@echo "$(GREEN)All dependencies installed!$(NC)"

install-backend:
	@echo "$(YELLOW)Installing Python backend dependencies...$(NC)"
	@cd backend && pip install -r requirements.txt 2>/dev/null || echo "$(RED)No requirements.txt or pip not available$(NC)"

install-frontend:
	@echo "$(YELLOW)Installing frontend dependencies...$(NC)"
	@cd front && npm install 2>/dev/null || echo "$(RED)No package.json or npm not available$(NC)"

install-go:
	@echo "$(YELLOW)Installing Go dependencies...$(NC)"
	@cd chatee-go && go mod download 2>/dev/null || echo "$(RED)No go.mod or go not available$(NC)"

install-nextjs:
	@echo "$(YELLOW)Installing Next.js dependencies...$(NC)"
	@cd new-chatee-front && npm install 2>/dev/null || echo "$(RED)No package.json or npm not available$(NC)"

# =============================================================================
# Build Commands
# =============================================================================

build-go:
	@echo "$(YELLOW)Building Go services...$(NC)"
	@cd chatee-go && make build

build-nextjs:
	@echo "$(YELLOW)Building Next.js frontend...$(NC)"
	@cd new-chatee-front && npm run build

# =============================================================================
# Git Helpers
# =============================================================================

# Show what will be committed (after clean)
git-status:
	@echo "$(YELLOW)Git status after clean:$(NC)"
	@git status --short

# Show large files that might slow down git
git-check-large:
	@echo "$(YELLOW)Checking for large files (>1MB)...$(NC)"
	@find . -type f -size +1M -not -path "./.git/*" -exec ls -lh {} \; 2>/dev/null || echo "No large files found"

# =============================================================================
# Help
# =============================================================================

help:
	@echo "$(GREEN)Chatee Project Makefile$(NC)"
	@echo ""
	@echo "$(YELLOW)Clean Commands:$(NC)"
	@echo "  make clean          - Clean all build artifacts and dependencies"
	@echo "  make clean-all      - Same as clean"
	@echo "  make clean-backend  - Clean Python backend only"
	@echo "  make clean-frontend - Clean Vue/React frontend only"
	@echo "  make clean-go       - Clean Go backend only"
	@echo "  make clean-nextjs   - Clean Next.js frontend only"
	@echo ""
	@echo "$(YELLOW)Install Commands:$(NC)"
	@echo "  make install-all    - Install all dependencies"
	@echo "  make install-backend- Install Python dependencies"
	@echo "  make install-frontend- Install frontend dependencies"
	@echo "  make install-go     - Install Go dependencies"
	@echo "  make install-nextjs - Install Next.js dependencies"
	@echo ""
	@echo "$(YELLOW)Build Commands:$(NC)"
	@echo "  make build-go       - Build Go microservices"
	@echo "  make build-nextjs   - Build Next.js frontend"
	@echo ""
	@echo "$(YELLOW)Git Helpers:$(NC)"
	@echo "  make git-status     - Show git status"
	@echo "  make git-check-large- Find large files (>1MB)"
	@echo ""
	@echo "$(YELLOW)Quick Start:$(NC)"
	@echo "  1. make clean       - Clean all artifacts before commit"
	@echo "  2. git add ."
	@echo "  3. git commit -m 'your message'"
	@echo "  4. git push"
