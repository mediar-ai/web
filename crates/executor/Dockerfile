# Build stage with dependency caching
FROM rust:latest AS chef
RUN cargo install cargo-chef
WORKDIR /app

# Plan dependencies
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# Build dependencies (cached layer)
FROM chef AS builder
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=planner /app/recipe.json recipe.json
# Build dependencies - this layer is cached unless dependencies change
RUN cargo chef cook --release --recipe-path recipe.json

# Build application (only rebuilds when source changes)
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# Runtime stage
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/workflow-executor /app/workflow-executor

RUN useradd -m -u 1000 executor && \
    chown -R executor:executor /app

USER executor

ENV RUST_LOG=info
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/v1/health || exit 1

CMD ["sh", "-c", "echo '=== STARTING WORKFLOW EXECUTOR ===' && ./workflow-executor serve 2>&1 | tee /tmp/app.log; echo '=== EXIT CODE: $? ===' && sleep 30"]
