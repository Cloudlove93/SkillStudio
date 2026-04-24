DOCKER ?= docker
TAG ?= latest
WEB_IMAGE ?= educlaw-web
SERVER_IMAGE ?= educlaw-server
KUBECTL ?= kubectl
K8S_DIR ?= k8s/base

.PHONY: docker-build-web docker-build-server docker-build-all docker-push-web docker-push-server docker-push-all up down k8s-render k8s-apply k8s-delete

docker-build-web:
	$(DOCKER) build -f educlaw-web/Dockerfile -t $(WEB_IMAGE):$(TAG) .

docker-build-server:
	$(DOCKER) build -f educlaw-server/Dockerfile -t $(SERVER_IMAGE):$(TAG) .

docker-build-all: docker-build-web docker-build-server

docker-push-web:
	$(DOCKER) push $(WEB_IMAGE):$(TAG)

docker-push-server:
	$(DOCKER) push $(SERVER_IMAGE):$(TAG)

docker-push-all: docker-push-web docker-push-server

up: docker-build-all
	docker compose up -d

down:
	docker compose down


k8s-render:
	$(KUBECTL) kustomize $(K8S_DIR)

k8s-apply:
	$(KUBECTL) apply -k $(K8S_DIR)

k8s-delete:
	$(KUBECTL) delete -k $(K8S_DIR)


lint:
	cd educlaw-server && pnpm lint
	cd educlaw-web && pnpm lint

format:
	cd educlaw-server && pnpm format
	cd educlaw-web && pnpm format

check: lint docker-build-all
