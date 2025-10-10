# Rust Workflow Executor - Makefile
# ==================================

.PHONY: help build test deploy deploy-dev deploy-staging deploy-prod logs clean

# Default target
help:
	@echo "Rust Workflow Executor - Available Commands"
	@echo "============================================"
	@echo ""
	@echo "Local Development:"
	@echo "  make build          - Build the project (debug)"
	@echo "  make release        - Build optimized release"
	@echo "  make test           - Run all tests"
	@echo "  make run            - Run the server locally"
	@echo "  make demo           - Run demo execution"
	@echo ""
	@echo "Azure Deployment:"
	@echo "  make deploy         - Deploy to dev environment"
	@echo "  make deploy-dev     - Deploy to dev environment"
	@echo "  make deploy-staging - Deploy to staging environment"
	@echo "  make deploy-prod    - Deploy to production environment"
	@echo ""
	@echo "Management:"
	@echo "  make logs           - View container logs (dev)"
	@echo "  make logs-prod      - View container logs (prod)"
	@echo "  make restart        - Restart dev container"
	@echo "  make clean          - Clean build artifacts"
	@echo ""

# Build commands
build:
	@echo "🏗️  Building debug version..."
	cargo build

release:
	@echo "🏗️  Building release version..."
	cargo build --release

# Test commands
test:
	@echo "🧪 Running tests..."
	cargo test --lib

test-all:
	@echo "🧪 Running all tests including examples..."
	cargo test
	cargo run --example demo_execution
	cargo run --example api_simulation

# Run commands
run:
	@echo "🚀 Starting local server..."
	cargo run

demo:
	@echo "🎬 Running demo execution..."
	cargo run --example demo_execution

# Deployment commands
deploy: deploy-dev

deploy-dev:
	@echo "🚀 Deploying to DEV environment..."
	./deploy.sh dev

deploy-staging:
	@echo "🚀 Deploying to STAGING environment..."
	./deploy.sh staging

deploy-prod:
	@echo "⚠️  PRODUCTION DEPLOYMENT"
	@read -p "Are you sure you want to deploy to production? (yes/no): " confirm && [ "$$confirm" = "yes" ]
	@echo "🚀 Deploying to PRODUCTION environment..."
	./deploy.sh prod

# Management commands
logs:
	@echo "📋 Fetching dev container logs..."
	az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg

logs-staging:
	@echo "📋 Fetching staging container logs..."
	az container logs -n workflow-executor-staging -g mediar-workflow-executor-rg

logs-prod:
	@echo "📋 Fetching production container logs..."
	az container logs -n workflow-executor-prod -g mediar-workflow-executor-rg

restart:
	@echo "🔄 Restarting dev container..."
	az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg

restart-prod:
	@echo "🔄 Restarting production container..."
	az container restart -n workflow-executor-prod -g mediar-workflow-executor-rg

status:
	@echo "📊 Container status (dev):"
	az container show -n workflow-executor-dev -g mediar-workflow-executor-rg --query "{Name:name,State:instanceView.state,IP:ipAddress.ip,FQDN:ipAddress.fqdn}" -o table

# Cleanup
clean:
	@echo "🧹 Cleaning build artifacts..."
	cargo clean
	rm -f *.log
	rm -f mcp_server.log terminator_mcp.log server_log.txt build_log.txt

# Docker local testing
docker-build:
	@echo "🐳 Building Docker image locally..."
	docker build -t workflow-executor:local .

docker-run:
	@echo "🐳 Running Docker container locally..."
	docker run -p 8080:8080 \
		-e DATABASE_URL="postgresql://localhost/workflow_executor" \
		-e MCP_ENDPOINT="http://host.docker.internal:3000" \
		-e RUST_LOG="workflow_executor=debug" \
		workflow-executor:local

# Health checks
health-dev:
	@echo "🏥 Checking dev endpoint health..."
	@FQDN=$$(az container show -n workflow-executor-dev -g mediar-workflow-executor-rg --query ipAddress.fqdn -o tsv); \
	curl -s "http://$$FQDN:8080/api/v1/health" | jq .

health-prod:
	@echo "🏥 Checking prod endpoint health..."
	@FQDN=$$(az container show -n workflow-executor-prod -g mediar-workflow-executor-rg --query ipAddress.fqdn -o tsv); \
	curl -s "http://$$FQDN:8080/api/v1/health" | jq .

# Quick deploy + verify
deploy-verify: deploy-dev
	@echo "⏳ Waiting 30 seconds for container to start..."
	@sleep 30
	@make health-dev

# CI/CD
ci: build test

# All-in-one for first time setup
setup:
	@echo "🎯 First-time setup..."
	@echo "1️⃣  Building project..."
	@make build
	@echo "2️⃣  Running tests..."
	@make test
	@echo "3️⃣  Running demo..."
	@make demo
	@echo ""
	@echo "✅ Setup complete! Ready to deploy with: make deploy"