#!/bin/bash

# Configuration
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}
ECR_REPOSITORY_NAME="websocket-gateway"
ECR_REPOSITORY_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY_NAME}"
IMAGE_TAG=${IMAGE_TAG:-latest}
CLUSTER_NAME=$(aws ecs list-clusters --query "clusterArns[?contains(@, 'WebsockerGatewayStack')]" --output text | sed 's/.*\///g')
SERVICE_NAME=$(aws ecs list-services --cluster $CLUSTER_NAME --query "serviceArns[?contains(@, 'WebSocketService')]" --output text | sed 's/.*\///g')

echo "Using cluster: $CLUSTER_NAME"
echo "Using service: $SERVICE_NAME"

# Get Redis endpoint from CDK outputs
REDIS_ENDPOINT=$(aws cloudformation describe-stacks --stack-name WebsockerGatewayStack --query "Stacks[0].Outputs[?OutputKey=='RedisEndpoint'].OutputValue" --output text)

if [ -z "$REDIS_ENDPOINT" ]; then
    echo "Warning: Redis endpoint not found in stack outputs, using default"
    REDIS_ENDPOINT="redis.local"
fi

echo "Using Redis endpoint: $REDIS_ENDPOINT"

# IAM Role names (these should match what CDK creates)
EXECUTION_ROLE_NAME="WebsockerGatewayStack-TaskDefTaskExecutionRole-*"
TASK_ROLE_NAME="WebsockerGatewayStack-TaskDefTaskRole-*"

# Get actual role ARNs
EXECUTION_ROLE_ARN=$(aws iam list-roles --query "Roles[?starts_with(RoleName, 'WebsockerGatewayStack-TaskExecutionRole')].Arn" --output text)
TASK_ROLE_ARN=$(aws iam list-roles --query "Roles[?starts_with(RoleName, 'WebsockerGatewayStack-TaskDefTaskRole')].Arn" --output text)

# Check if roles were found
if [ -z "$EXECUTION_ROLE_ARN" ]; then
    echo "Error: Execution role not found"
    exit 1
fi

if [ -z "$TASK_ROLE_ARN" ]; then
    echo "Error: Task role not found"
    exit 1
fi

# Extract role names from ARNs for the template
EXECUTION_ROLE_NAME=$(echo $EXECUTION_ROLE_ARN | sed 's/.*\///')
TASK_ROLE_NAME=$(echo $TASK_ROLE_ARN | sed 's/.*\///')

echo "Using Execution Role: $EXECUTION_ROLE_ARN"
echo "Using Task Role: $TASK_ROLE_ARN"

# Build and push Docker image
echo "Building Docker image..."
docker build --platform linux/amd64 -t ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} .

echo "Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

echo "Tagging and pushing image..."
docker tag ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} ${ECR_REPOSITORY_URI}:${IMAGE_TAG}
docker push ${ECR_REPOSITORY_URI}:${IMAGE_TAG}

# Create task definition from template
echo "Creating task definition..."
sed -e "s/{{ACCOUNT_ID}}/${ACCOUNT_ID}/g" \
    -e "s/{{ECR_REPOSITORY_URI}}/${ECR_REPOSITORY_URI//\//\\/}/g" \
    -e "s/{{IMAGE_TAG}}/${IMAGE_TAG}/g" \
    -e "s/{{AWS_REGION}}/${AWS_REGION}/g" \
    -e "s/{{REDIS_ENDPOINT}}/${REDIS_ENDPOINT}/g" \
    -e "s|{{EXECUTION_ROLE_NAME}}|${EXECUTION_ROLE_NAME}|g" \
    -e "s|{{TASK_ROLE_NAME}}|${TASK_ROLE_NAME}|g" \
    templates/task-definition-template.json > task-definition.json

# Register new task definition
echo "Registering task definition..."
TASK_DEFINITION_ARN=$(aws ecs register-task-definition \
    --cli-input-json file://task-definition.json \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

if [ $? -ne 0 ] || [ -z "$TASK_DEFINITION_ARN" ]; then
    echo "Error: Failed to register task definition"
    exit 1
fi

echo "New task definition: $TASK_DEFINITION_ARN"

# Update service
echo "Updating service..."
aws ecs update-service \
    --cluster ${CLUSTER_NAME} \
    --service ${SERVICE_NAME} \
    --task-definition ${TASK_DEFINITION_ARN} \
    --no-cli-pager \
    --query "service.{ServiceName:serviceName, Status:status, TaskDefinition:taskDefinition}" \
    --output table

if [ $? -ne 0 ]; then
    echo "Error: Failed to update service"
    exit 1
fi

echo "Deployment initiated!"
echo "Task Definition ARN: $TASK_DEFINITION_ARN"

# Clean up generated task definition file
rm -f task-definition.json

echo "Done!"
