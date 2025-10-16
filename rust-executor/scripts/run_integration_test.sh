#!/bin/bash
set -e

# ==============================================================================
# Integration Test Runner for Rust Executor + Terminator MCP
# ==============================================================================
# This script runs a local integration test that:
# 1. Builds the Terminator MCP agent if needed
# 2. Loads environment variables from .env
# 3. Runs the Rust executor integration test with screenshot capture
# 4. Verifies the integration works end-to-end
# ==============================================================================

echo "=================================================================="
echo "🧪 Rust Executor + Terminator MCP Integration Test"
echo "=================================================================="
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RUST_EXECUTOR_DIR="$(dirname "$SCRIPT_DIR")"
TERMINATOR_DIR="$RUST_EXECUTOR_DIR/../../terminator"

echo "📂 Directories:"
echo "   Rust Executor: $RUST_EXECUTOR_DIR"
echo "   Terminator:    $TERMINATOR_DIR"
echo ""

# Load environment variables from .env if it exists
if [ -f "$RUST_EXECUTOR_DIR/.env" ]; then
    echo "📄 Loading environment variables from .env..."
    set -a
    source "$RUST_EXECUTOR_DIR/.env"
    set +a
    echo "   ✓ Environment loaded"
    echo ""
else
    echo "⚠️  No .env file found - using defaults"
    echo "   Create .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for upload testing"
    echo ""
fi

# Check if Terminator exists
if [ ! -d "$TERMINATOR_DIR" ]; then
    echo "❌ Terminator directory not found at: $TERMINATOR_DIR"
    echo "   Please ensure the terminator repo is cloned alongside rust-executor"
    exit 1
fi

# Build Terminator MCP agent if needed
TERMINATOR_BINARY="$TERMINATOR_DIR/target/release/terminator-mcp-agent"
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    TERMINATOR_BINARY="${TERMINATOR_BINARY}.exe"
fi

if [ ! -f "$TERMINATOR_BINARY" ]; then
    echo "🔨 Building Terminator MCP agent..."
    cd "$TERMINATOR_DIR"
    cargo build --release --package terminator-mcp-agent
    cd "$RUST_EXECUTOR_DIR"
    echo "   ✓ Terminator built successfully"
    echo ""
else
    echo "✓ Terminator MCP agent already built"
    echo ""
fi

# Run the integration test
echo "🚀 Running integration test..."
echo ""

cd "$RUST_EXECUTOR_DIR"

# Set Rust log level for better visibility
export RUST_LOG="${RUST_LOG:-info}"

# Run the example
cargo run --example test_screenshot_integration

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "=================================================================="
    echo "✅ Integration test PASSED!"
    echo "=================================================================="
    echo ""
    echo "The test successfully:"
    echo "  • Connected to Terminator MCP server"
    echo "  • Executed a workflow with browser automation"
    echo "  • Captured screenshots via the MCP tools"

    if [ -n "$SUPABASE_URL" ]; then
        echo "  • Uploaded screenshots to Supabase (if successful)"
        echo ""
        echo "💡 Check your Supabase storage bucket for uploaded screenshots"
    else
        echo ""
        echo "💡 To test Supabase upload, add to .env:"
        echo "   SUPABASE_URL=https://your-project.supabase.co"
        echo "   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key"
    fi
    echo ""
else
    echo ""
    echo "=================================================================="
    echo "❌ Integration test FAILED"
    echo "=================================================================="
    echo ""
    echo "Check the output above for error details"
    exit 1
fi
