# OpenTelemetry Collector for MCP Telemetry
FROM otel/opentelemetry-collector-contrib:0.91.0

# Copy configuration file
COPY otel-config.yaml /etc/otel-collector-config.yaml

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:13133/ || exit 1

# Run with custom config
CMD ["--config=/etc/otel-collector-config.yaml"]