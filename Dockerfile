FROM golang:1.26.9-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web

COPY web/ ./web/
RUN npm run build --prefix web

COPY backend/ ./backend/
COPY Makefile ./

ARG VERSION=dev
RUN mkdir -p dist && go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o dist/agentstat ./backend

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates sqlite3 libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist/agentstat ./agentstat

EXPOSE 8080

ENV AGENTSTAT_ADDR=0.0.0.0:8080
ENV AGENTSTAT_DB=/data/agentstat.db

VOLUME ["/data", "/sources"]

ENTRYPOINT ["./agentstat"]
