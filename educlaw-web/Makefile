DOCKER ?= docker
TAG ?= latest
IMAGE ?= educlaw-web

.PHONY: dev build lint format docker-build docker-push

dev:
	pnpm dev

build:
	pnpm build

lint:
	pnpm lint

format:
	pnpm format

docker-build:
	$(DOCKER) build -f Dockerfile -t $(IMAGE):$(TAG) ..

docker-push:
	$(DOCKER) push $(IMAGE):$(TAG)

