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

# Real infrastructure dev
.PHONY: gen-env
gen-env: ## Generate .env.real from deployed AWS resources
	./scripts/generate-env.sh

.PHONY: dev-real
dev-real: ## Start server against real AWS Cognito (auto-fetches JWT)
	./scripts/start-real.sh --token

# Local development
.PHONY: dev-local
dev-local: ## Start self-contained local environment (Redis included, no AWS or env vars needed)
	docker compose -f docker-compose.local.yml up --build

.PHONY: dev-local-stop
dev-local-stop: ## Stop the local dev environment
	docker compose -f docker-compose.local.yml down

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

.PHONY: deploy-image
deploy-image: ## Build (arm64), push to ECR, force new ECS deployment — no CDK needed
	./scripts/deploy-image.sh

.PHONY: deploy-image-tail
deploy-image-tail: ## Like deploy-image but tails ECS logs after deploying
	./scripts/deploy-image.sh --tail

.PHONY: ecs-status
ecs-status: ## Show ECS service running/desired task counts and latest events
	@CLUSTER=$$(aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(AWS_REGION) \
	  --query 'Stacks[0].Outputs[?OutputKey==`ClusterArn`].OutputValue' --output text 2>/dev/null); \
	SERVICE=$$(aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(AWS_REGION) \
	  --query 'Stacks[0].Outputs[?OutputKey==`ServiceArn`].OutputValue' --output text 2>/dev/null); \
	aws ecs describe-services --cluster "$$CLUSTER" --services "$$SERVICE" --region $(AWS_REGION) \
	  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount,Events:events[0:5]}' \
	  --output json

.PHONY: ecs-logs
ecs-logs: ## Tail the latest ECS task logs from CloudWatch
	@LOG_GROUP=$$(aws logs describe-log-groups --region $(AWS_REGION) \
	  --log-group-name-prefix "$(STACK_NAME)-TaskDef" \
	  --query 'sort_by(logGroups, &creationTime)[-1].logGroupName' --output text 2>/dev/null); \
	echo "Log group: $$LOG_GROUP"; \
	aws logs tail "$$LOG_GROUP" --follow --region $(AWS_REGION)

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
	npm run cdk -- deploy --require-approval never

.PHONY: cdk-watch
cdk-watch: ## Deploy CDK stack and monitor ECS tasks for failures in real time
	./scripts/watch-deploy.sh

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

# LocalStack development
.PHONY: dev-localstack
dev-localstack: ## Start LocalStack dev environment (EventBridge, SQS, Lambda, DynamoDB, Redis)
	docker compose -f docker-compose.localstack.yml up --build

.PHONY: dev-localstack-stop
dev-localstack-stop: ## Stop LocalStack dev environment
	docker compose -f docker-compose.localstack.yml down

.PHONY: dev-localstack-logs
dev-localstack-logs: ## Tail LocalStack container logs
	docker compose -f docker-compose.localstack.yml logs -f localstack

# Lambda invocation
.PHONY: invoke-lambda
invoke-lambda: ## Invoke a Lambda against LocalStack (FUNC=activity-log PAYLOAD='{}')
	./scripts/invoke-lambda.sh $(FUNC) '$(PAYLOAD)'

.PHONY: dev-localstack-debug
dev-localstack-debug: ## Start LocalStack with Lambda debug mode (attach VS Code to port 9229)
	docker compose -f docker-compose.localstack.yml -f docker-compose.debug.yml up --build
