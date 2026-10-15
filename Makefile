.DEFAULT_GOAL := all
.PHONY: all web-assets build lint go-lint coverage check vulncheck
VERSION ?= dev
GOVULNCHECK_VERSION := v1.9.0

all: check
	mkdir -p dist
	go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o dist/agentstat ./backend

web-assets:
	npm run build --prefix web

build: web-assets
	mkdir -p dist
	go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o dist/agentstat ./backend

lint: web-assets
	@test -z "$$(gofmt -l backend/*.go)" || { gofmt -l backend/*.go; exit 1; }
	$(MAKE) go-lint
	npm run lint --prefix web
	npm run format:check --prefix web

go-lint:
	sh scripts/golangci-lint.sh run ./backend/...

coverage: web-assets
	sh scripts/check-coverage.sh
	npm run coverage --prefix web

check: lint coverage
	go test ./...

vulncheck:
	go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) ./...
