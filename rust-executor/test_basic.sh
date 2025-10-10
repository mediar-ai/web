#!/bin/bash

# Basic test script for the Rust workflow executor
# This tests the basic API functionality without needing a database

echo "======================================"
echo "Basic Rust Workflow Executor Test"
echo "======================================"

API_URL="http://localhost:8080/api/v1"

# Function to check if server is running
check_server() {
    echo -n "Checking if server is running... "
    if curl -s "${API_URL}/health" > /dev/null 2>&1; then
        echo "✓ Server is running"
        return 0
    else
        echo "✗ Server is not running"
        echo ""
        echo "To start the server, run:"
        echo "  cd rust-executor && cargo run"
        return 1
    fi
}

# Test health endpoint
test_health() {
    echo ""
    echo "Testing health endpoint:"
    response=$(curl -s "${API_URL}/health")
    echo "Response: $response"

    if echo "$response" | grep -q "healthy"; then
        echo "✓ Health check passed"
        return 0
    else
        echo "✗ Health check failed"
        return 1
    fi
}

# Test workflows endpoint (will fail without database, but tests the endpoint)
test_workflows() {
    echo ""
    echo "Testing workflows endpoint:"
    response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "${API_URL}/workflows")

    http_status=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
    body=$(echo "$response" | grep -v "HTTP_STATUS")

    echo "HTTP Status: $http_status"

    if [ "$http_status" = "200" ]; then
        echo "✓ Workflows endpoint responding"
        echo "Response: $body"
    else
        echo "⚠ Workflows endpoint returned error (expected without database)"
        echo "Response: $body"
    fi
}

# Test queue status endpoint
test_queue_status() {
    echo ""
    echo "Testing queue status endpoint:"
    response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "${API_URL}/queue/status")

    http_status=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
    body=$(echo "$response" | grep -v "HTTP_STATUS")

    echo "HTTP Status: $http_status"

    if [ "$http_status" = "200" ]; then
        echo "✓ Queue status endpoint responding"
        echo "Response: $body"
    else
        echo "⚠ Queue status endpoint returned error (expected without database)"
        echo "Response: $body"
    fi
}

# Run tests
main() {
    if ! check_server; then
        exit 1
    fi

    test_health
    test_workflows
    test_queue_status

    echo ""
    echo "======================================"
    echo "Basic tests completed"
    echo ""
    echo "Note: Some endpoints will fail without a configured database."
    echo "To test with a database, set up PostgreSQL and configure DATABASE_URL."
    echo "======================================"
}

main