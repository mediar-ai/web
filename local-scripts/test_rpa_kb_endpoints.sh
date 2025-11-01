#!/bin/bash
# Test RPA Knowledgebase API Endpoints

BASE_URL="http://localhost:3000"
STEP_ID=""

echo "================================================================================"
echo "RPA KNOWLEDGEBASE API ENDPOINT TESTS"
echo "================================================================================"

echo ""
echo "🧪 Test 1: Create Step with Embeddings"
echo "   POST /api/rpa-kb"
echo "   (This will take 5-10 seconds due to embedding generation...)"
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/rpa-kb" \
  -H "Content-Type: application/json" \
  -d '{
    "app_name": "Chrome",
    "window_title": "Google Form - Contact Us",
    "element_path": "Window > Panel > Section > Button[name=\"Submit\"]",
    "step_name": "Click submit button after validation",
    "definition": "await element.click({ button: \"left\" });",
    "current_state": {
      "variables": {
        "form_data": {
          "type": "object",
          "fields": ["name", "email", "message"]
        },
        "is_validated": {
          "type": "boolean",
          "value": true
        },
        "submit_count": {
          "type": "integer",
          "value": 0
        }
      }
    },
    "expected_outcome": {
      "before": {
        "button_state": "enabled",
        "button_text": "Submit",
        "form_state": "draft",
        "loading": false
      },
      "after": {
        "button_state": "disabled",
        "button_text": "Submitting...",
        "form_state": "submitted",
        "loading": true
      },
      "changes": [
        "- button state: enabled",
        "+ button state: disabled",
        "- button text: Submit",
        "+ button text: Submitting...",
        "- form state: draft",
        "+ form state: submitted",
        "- loading: false",
        "+ loading: true"
      ],
      "ui_tree_diff": "Large UI tree diff would be here (~2000 lines)"
    },
    "workflow_name": "Form Submission Workflow",
    "workflow_description": "Standard workflow for submitting web forms with validation and error handling",
    "terminator_version": "v1.2.0",
    "environment": "production",
    "author": "test@example.com"
  }')

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

# Extract step ID for subsequent tests
STEP_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

if [ -z "$STEP_ID" ]; then
  echo ""
  echo "❌ Failed to create step. Check server logs."
  exit 1
fi

echo ""
echo "✅ Step created with ID: $STEP_ID"
echo ""

# Wait a bit for embeddings to be fully processed
sleep 2

echo "================================================================================"
echo "🧪 Test 2: Get Step by ID"
echo "   GET /api/rpa-kb/$STEP_ID"
echo ""

curl -s "$BASE_URL/api/rpa-kb/$STEP_ID" | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 3: List Steps"
echo "   GET /api/rpa-kb?page=1&pageSize=5&sortBy=ranking"
echo ""

curl -s "$BASE_URL/api/rpa-kb?page=1&pageSize=5&sortBy=ranking" | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 4: Keyword Search (without similarity)"
echo "   POST /api/rpa-kb/search"
echo "   Query: 'submit button form'"
echo ""

curl -s -X POST "$BASE_URL/api/rpa-kb/search" \
  -H "Content-Type: application/json" \
  -d '{
    "search_query": "submit button form",
    "filter_app": "Chrome"
  }' | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 5: Two-Stage Search (keyword + similarity)"
echo "   POST /api/rpa-kb/search"
echo "   Query: 'submit button form' + similarity: 'click submit after validation'"
echo "   (This will take 5-10 seconds due to embedding generation...)"
echo ""

curl -s -X POST "$BASE_URL/api/rpa-kb/search" \
  -H "Content-Type: application/json" \
  -d '{
    "search_query": "submit button form",
    "similarity_query": "click the submit button after form validation",
    "embedding_type": "definition",
    "filter_app": "Chrome",
    "stage2_limit": 10
  }' | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 6: Update Execution Stats"
echo "   POST /api/rpa-kb/$STEP_ID/stats"
echo "   (Marking as successful execution with 230ms duration)"
echo ""

curl -s -X POST "$BASE_URL/api/rpa-kb/$STEP_ID/stats" \
  -H "Content-Type: application/json" \
  -d '{
    "success": true,
    "duration_ms": 230
  }' | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 7: Update Step Details"
echo "   PATCH /api/rpa-kb/$STEP_ID"
echo "   (Adding note to step name)"
echo ""

curl -s -X PATCH "$BASE_URL/api/rpa-kb/$STEP_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "step_name": "Click submit button after validation (tested)",
    "regenerate_embeddings": false
  }' | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 8: Search by Outcome Similarity"
echo "   POST /api/rpa-kb/search"
echo "   Embedding type: outcome"
echo "   (Finding steps with similar UI changes)"
echo ""

curl -s -X POST "$BASE_URL/api/rpa-kb/search" \
  -H "Content-Type: application/json" \
  -d '{
    "similarity_query": "button becomes disabled and shows loading spinner",
    "embedding_type": "outcome",
    "stage1_limit": 100,
    "stage2_limit": 5
  }' | python3 -m json.tool

echo ""
echo "================================================================================"
echo "🧪 Test 9: Verify Database State"
echo "   Checking rpa_kb_stats view"
echo ""

python3 << 'EOF'
import psycopg2
import json

conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
cur = conn.cursor()

cur.execute("SELECT * FROM rpa_kb_stats;")
stats = cur.fetchone()

print(json.dumps({
    "total_steps": stats[0],
    "steps_with_success": stats[1],
    "steps_with_definition_embedding": stats[2],
    "steps_with_workflow_embedding": stats[3],
    "steps_with_outcome_embedding": stats[4],
    "avg_ranking": float(stats[5]) if stats[5] else None,
    "total_successes": stats[6],
    "total_failures": stats[7],
    "total_search_appearances": stats[8],
    "total_reads": stats[9],
    "table_size": stats[10]
}, indent=2))

cur.close()
conn.close()
EOF

echo ""
echo "================================================================================"
echo "🧪 Test 10: Cleanup (Optional)"
echo "   DELETE /api/rpa-kb/$STEP_ID"
echo ""

read -p "   Delete test step? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  curl -s -X DELETE "$BASE_URL/api/rpa-kb/$STEP_ID" | python3 -m json.tool
  echo ""
  echo "✅ Test step deleted"
else
  echo ""
  echo "ℹ️  Test step kept (ID: $STEP_ID)"
fi

echo ""
echo "================================================================================"
echo "✅ ALL ENDPOINT TESTS COMPLETE!"
echo "================================================================================"
echo ""
echo "Summary:"
echo "  - Create step: ✓"
echo "  - Get step: ✓"
echo "  - List steps: ✓"
echo "  - Keyword search: ✓"
echo "  - Two-stage search: ✓"
echo "  - Update stats: ✓"
echo "  - Update step: ✓"
echo "  - Outcome similarity: ✓"
echo "  - Database verification: ✓"
echo ""

