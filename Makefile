# WebSocket Gateway Makefile

# Variables
IMAGE_NAME = websocket-gateway
IMAGE_TAG ?= latest
AWS_REGION ?= us-east-1
AWS_ACCOUNT_ID ?= $(shell aws sts get-caller-identity --query Account --output text)
ECR_REPOSITORY = $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/$(IMAGE_NAME)
STACK_NAME = WebsockerGatewayStack

# Service Configuration
SERVICE_TYPE ?= full
CONFIG_FILE = config/$(SERVICE_TYPE)-service.env

# Default target
.PHONY: help
help: ## Show this help message
	@echo "WebSocket Gateway Development Commands"
	@echo "======================================"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  %-25s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# Local development
.PHONY: dev
dev: ## Start local development environment
	@echo "Starting $(SERVICE_TYPE) service in development mode..."
	SERVICE_TYPE=$(SERVICE_TYPE) docker compose --env-file $(CONFIG_FILE) up --build

.PHONY: dev-detached
dev-detached: ## Start local development environment in background
	@echo "Starting $(SERVICE_TYPE) service in background..."
	SERVICE_TYPE=$(SERVICE_TYPE) docker compose --env-file $(CONFIG_FILE) up -d --build

.PHONY: dev-logs
dev-logs: ## Show logs from local development environment
	docker compose logs -f websocket-gateway

.PHONY: dev-stop
dev-stop: ## Stop local development environment
	docker compose down

.PHONY: dev-clean
dev-clean: ## Stop and remove all containers, networks, and volumes
	docker compose down -v --remove-orphans
	docker system prune -f

# Building
.PHONY: build
build: ## Build Docker image locally
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

.PHONY: build-cdk
build-cdk: ## Build CDK TypeScript code
	npm run build

# ECR operations
.PHONY: ecr-login
ecr-login: ## Login to AWS ECR
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REPOSITORY)

.PHONY: ecr-create
ecr-create: ## Create ECR repository if it doesn't exist
	@aws ecr describe-repositories --repository-names $(IMAGE_NAME) --region $(AWS_REGION) >/dev/null 2>&1 || \
	aws ecr create-repository --repository-name $(IMAGE_NAME) --region $(AWS_REGION)

.PHONY: build-and-push
build-and-push: ecr-login ecr-create build ## Build and push Docker image to ECR
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(ECR_REPOSITORY):$(IMAGE_TAG)
	docker push $(ECR_REPOSITORY):$(IMAGE_TAG)
	@echo "Image pushed to: $(ECR_REPOSITORY):$(IMAGE_TAG)"

# Deployment
.PHONY: deploy
deploy: ## Deploy to AWS using deploy.sh script
	./deploy.sh

.PHONY: deploy-full
deploy-full: build-and-push deploy ## Build, push, and deploy complete application
	@echo "Full deployment completed!"

# CDK operations
.PHONY: cdk-synth
cdk-synth: build-cdk ## Synthesize CDK stack
	npm run cdk synth

.PHONY: cdk-diff
cdk-diff: build-cdk ## Show differences between current and deployed stack
	npm run cdk diff

.PHONY: cdk-deploy
cdk-deploy: build-cdk ## Deploy CDK stack
	npm run cdk deploy --require-approval never

.PHONY: cdk-destroy
cdk-destroy: ## Destroy CDK stack
	npm run cdk destroy --force

# Utilities
.PHONY: get-websocket-url
get-websocket-url: ## Get the deployed WebSocket URL
	@aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(AWS_REGION) \
		--query 'Stacks[0].Outputs[?OutputKey==`WebSocketURL`].OutputValue' --output text

.PHONY: get-redis-endpoint
get-redis-endpoint: ## Get the deployed Redis endpoint
	@aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(AWS_REGION) \
		--query 'Stacks[0].Outputs[?OutputKey==`RedisEndpoint`].OutputValue' --output text

.PHONY: install
install: ## Install dependencies
	npm install

.PHONY: clean
clean: ## Clean build artifacts and temporary files
	rm -rf node_modules
	rm -rf cdk.out
	rm -rf dist
	rm -f task-definition*.json
	rm -f latest-task-def-arn.tmp
	rm -f current-task-def.json
	rm -f updated-task-def.json
	rm -f container-definitions.json
	@echo "Clean completed!"

# Quick start
.PHONY: setup
setup: install build-cdk ## Initial setup - install dependencies and build
	@echo "Setup complete! Run 'make dev' to start local development"

.PHONY: test-local
test-local: dev-detached ## Start local environment and show connection info
	@echo "Waiting for services to start..."
	@sleep 5
	@echo "Services started!"
	@echo "WebSocket Server: ws://localhost:8080"
	@echo "Test connection with: wscat -c ws://localhost:8080"
	@echo "View logs with: make dev-logs"
	@echo "Stop with: make dev-stop"

.PHONY: open-test-client
open-test-client: ## Open test client HTML file in browser
	@echo "Opening WebSocket test client..."
	@open test/clients/test-client.html
