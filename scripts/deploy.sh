#!/bin/bash
set -e

ACCOUNT="264161986065"
REGION="${AWS_REGION:-us-east-1}"
REPO="websocket-gateway"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}"
TAG="${IMAGE_TAG:-latest}"

echo "==> Authenticating with ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Creating ECR repository (if not exists)..."
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" > /dev/null 2>&1 || \
  aws ecr create-repository --repository-name "$REPO" --region "$REGION"

echo "==> Building Docker image..."
docker build -t "${REPO}:${TAG}" "$(dirname "$0")/.."

echo "==> Tagging and pushing to ECR..."
docker tag "${REPO}:${TAG}" "${ECR_URI}:${TAG}"
docker push "${ECR_URI}:${TAG}"

echo "==> Deploying CDK stack..."
IMAGE_URI="${ECR_URI}:${TAG}" \
ACM_CERTIFICATE_ARN="${ACM_CERTIFICATE_ARN:-arn:aws:acm:us-east-1:264161986065:certificate/4e841ee9-ac51-4738-8149-8da219ccc66f}" \
  npx cdk deploy --require-approval never

echo ""
echo "==> Deploy complete!"
echo "    Image: ${ECR_URI}:${TAG}"
