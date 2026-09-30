DOCKER ?= docker
TAG ?= latest
IMAGE ?= educlaw-server

.PHONY: dev build test lint format docker-build docker-push

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

format:
	pnpm format

docker-build:
	$(DOCKER) build -f Dockerfile -t $(IMAGE):$(TAG) ..

docker-push:
	$(DOCKER) push $(IMAGE):$(TAG)

