# RPA Knowledgebase Setup - Complete Guide

## Overview

A scalable workflow execution steps database with **two-stage search** (keyword + vector similarity), optimized for millions of records.

### Key Features
- ✅ **Two-stage search**: Keywords (Stage 1) → Vector similarity (Stage 2)
- ✅ **Smart ranking**: Success rate + Frequency + Recency + Speed
- ✅ **3 vector embeddings**: Definition, Workflow, Outcome similarity
- ✅ **JSONB storage**: Flexible state and outcome storage
- ✅ **Full-text search**: Across app, window, step, workflow
- ✅ **Supabase only**: No external dependencies (R2, OpenAI)
- ✅ **Vertex AI embeddings**: text-embedding-004 (768 dimensions)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RPA Knowledgebase                        │
│                                                             │
│  Table: rpa_knowledgebase                                  │
│  - 25+ columns (metadata, state, outcome, embeddings)      │
│  - 15 indexes (3 HNSW vector, 2 GIN JSONB, 10 B-tree)     │
│  - 4 search functions                                       │
│  - 1 stats view                                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │    Two-Stage Search System        │
        └───────────────────────────────────┘
                 │                │
                 ▼                ▼
        ┌────────────┐   ┌─────────────────┐
        │  Stage 1:  │   │    Stage 2:     │
        │  Keyword   │   │    Vector       │
        │  Search    │   │  Similarity     │
        │  (500 IDs) │   │   (Top 20)      │
        └────────────┘   └─────────────────┘
```

---

## Setup Instructions

### Step 1: Run Migration

```bash
cd /Users/matthewdi/Desktop/screenpipe/browser-workflow-capture-app
python3 local-scripts/setup_rpa_knowledgebase.py
```

This will:
- Install PostgreSQL extensions (`vector`, `pg_trgm`)
- Create `rpa_knowledgebase` table with 25+ columns
- Create 15 indexes for performance
- Create 4 SQL functions for search
- Create monitoring view

**Expected output:**
```
================================================================================
RPA KNOWLEDGEBASE SETUP
================================================================================

✅ Connected to database
✅ Table exists (or created)
✅ Migration completed successfully!

Verifying installation...
   Table columns: 25
   Indexes created: 15
   Function search_rpa_kb_keyword: ✅
   Function search_rpa_kb_similarity: ✅
   Function search_rpa_kb_two_stage: ✅
   Function increment_rpa_kb_stats: ✅
   View rpa_kb_stats: ✅

✅ SETUP COMPLETE!
```

### Step 2: Test Setup

```bash
python3 local-scripts/test_rpa_kb_setup.py
```

This will:
- Insert sample step (without embeddings)
- Test keyword search
- Test JSONB queries
- Test stats updates
- Test full-text search

**Expected output:**
```
✅ ALL TESTS PASSED!
```

### Step 3: Verify Environment Variables

Ensure these are set (for embeddings):

```bash
# Vertex AI credentials (one of these methods)
GOOGLE_CLIENT_EMAIL=xxx
GOOGLE_PRIVATE_KEY=xxx
# OR
GOOGLE_APPLICATION_CREDENTIALS_BASE64=xxx

# Vertex AI config
GOOGLE_CLOUD_PROJECT=mediar-394022
VERTEX_AI_LOCATION=us-central1

# Supabase
NEXT_PUBLIC_SUPABASE_URL=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

---

## API Endpoints

### 1. Create Step with Embeddings

**POST /api/rpa-kb**

```bash
curl -X POST http://localhost:3000/api/rpa-kb \
  -H "Content-Type: application/json" \
  -d '{
    "app_name": "Chrome",
    "window_title": "Google Form",
    "element_path": "Window > Panel > Button[name=\"Submit\"]",
    "step_name": "Click submit button",
    "definition": "await element.click({ button: \"left\" })",
    "current_state": {
      "variables": {
        "form_data": {"type": "object"},
        "is_validated": {"type": "boolean", "value": true}
      }
    },
    "expected_outcome": {
      "before": {"button_state": "enabled"},
      "after": {"button_state": "disabled"},
      "changes": ["- button enabled", "+ button disabled"]
    },
    "workflow_name": "Form Submission Workflow",
    "workflow_description": "Submit forms with validation",
    "terminator_version": "v1.0.0",
    "environment": "production",
    "author": "user@example.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "ranking": 45.2,
    "definition_embedding": [0.123, 0.456, ...],
    "workflow_embedding": [0.789, 0.012, ...],
    "outcome_embedding": [0.345, 0.678, ...]
  },
  "message": "Step created with embeddings"
}
```

---

### 2. Search (Two-Stage)

**POST /api/rpa-kb/search**

```bash
curl -X POST http://localhost:3000/api/rpa-kb/search \
  -H "Content-Type: application/json" \
  -d '{
    "search_query": "submit button form",
    "similarity_query": "click the submit button after validation",
    "embedding_type": "definition",
    "filter_app": "Chrome",
    "stage2_limit": 10
  }'
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "step_id": "uuid",
      "app_name": "Chrome",
      "step_name": "Click submit button",
      "ranking": 85.5,
      "similarity_score": 0.92,
      "combined_score": 0.89
    }
  ],
  "metadata": {
    "has_similarity": true,
    "result_count": 10
  }
}
```

**Search Types:**
- `embedding_type: "definition"` - Find similar step definitions
- `embedding_type: "workflow"` - Find steps from similar workflows
- `embedding_type: "outcome"` - Find steps with similar UI outcomes

---

### 3. Update Execution Stats

**POST /api/rpa-kb/[id]/stats**

```bash
curl -X POST http://localhost:3000/api/rpa-kb/uuid-here/stats \
  -H "Content-Type: application/json" \
  -d '{
    "success": true,
    "duration_ms": 250
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "succeeded": 11,
    "failed": 1,
    "duration_ms": 248,
    "ranking": 87.3,
    "last_executed_at": "2025-01-16T12:00:00Z"
  }
}
```

---

### 4. Get Step Details

**GET /api/rpa-kb/[id]**

```bash
curl http://localhost:3000/api/rpa-kb/uuid-here
```

Automatically increments `times_read` counter.

---

### 5. Update Step

**PATCH /api/rpa-kb/[id]**

```bash
curl -X PATCH http://localhost:3000/api/rpa-kb/uuid-here \
  -H "Content-Type: application/json" \
  -d '{
    "step_name": "Click submit button with validation",
    "regenerate_embeddings": true
  }'
```

Regenerates embeddings if key fields change.

---

### 6. Delete Step

**DELETE /api/rpa-kb/[id]**

```bash
curl -X DELETE http://localhost:3000/api/rpa-kb/uuid-here
```

---

### 7. List Steps

**GET /api/rpa-kb?page=1&pageSize=20&sortBy=ranking**

```bash
curl "http://localhost:3000/api/rpa-kb?page=1&pageSize=20&app=Chrome&sortBy=ranking"
```

**Query params:**
- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 20)
- `app` - Filter by app name
- `workflow` - Filter by workflow name
- `author` - Filter by author
- `environment` - Filter by environment
- `sortBy` - Sort by: `ranking`, `created_at`, `last_executed_at`

---

## Database Schema

### Main Table

```sql
rpa_knowledgebase (
  id UUID PRIMARY KEY,
  
  -- Identifiers
  app_name TEXT,
  window_title TEXT,
  element_path TEXT,
  
  -- Step definition
  step_name TEXT,
  definition TEXT,
  
  -- Execution stats
  succeeded INTEGER,
  failed INTEGER,
  duration_ms INTEGER,
  
  -- Usage analytics
  appeared_in_search INTEGER,
  times_read INTEGER,
  
  -- Computed ranking (auto-calculated)
  ranking NUMERIC GENERATED ALWAYS AS (...) STORED,
  
  -- State & Outcome (JSONB)
  current_state JSONB,
  expected_outcome JSONB,
  
  -- Metadata
  workflow_name TEXT,
  workflow_description TEXT,
  terminator_version TEXT,
  environment TEXT,
  author TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ,
  last_executed_at TIMESTAMPTZ,
  
  -- Vector embeddings (768 dimensions)
  definition_embedding vector(768),
  workflow_embedding vector(768),
  outcome_embedding vector(768),
  
  -- Full-text search
  search_vector tsvector GENERATED ALWAYS AS (...) STORED
);
```

### Indexes (15 total)

1. **B-tree indexes** (9): app_name, window_title, workflow_name, author, environment, ranking, created_at, last_executed_at, composite indexes
2. **GIN indexes** (3): search_vector (full-text), current_state (JSONB), expected_outcome (JSONB)
3. **HNSW indexes** (3): definition_embedding, workflow_embedding, outcome_embedding

---

## SQL Functions

### 1. search_rpa_kb_keyword()
Stage 1: Keyword search with filters. Returns top 500 IDs.

```sql
SELECT * FROM search_rpa_kb_keyword(
  search_query := 'button click',
  filter_app := 'Chrome',
  result_limit := 500
);
```

### 2. search_rpa_kb_similarity()
Stage 2: Vector similarity within filtered IDs. Returns top 20.

```sql
SELECT * FROM search_rpa_kb_similarity(
  step_ids := ARRAY['uuid1', 'uuid2'],
  query_embedding := '[0.123, 0.456, ...]',
  embedding_type := 'definition',
  result_limit := 20
);
```

### 3. search_rpa_kb_two_stage()
Combined two-stage search (keyword + vector).

```sql
SELECT * FROM search_rpa_kb_two_stage(
  search_query := 'form submit',
  query_embedding := '[0.123, ...]',
  embedding_type := 'outcome',
  filter_app := 'Chrome',
  stage1_limit := 500,
  stage2_limit := 20
);
```

### 4. increment_rpa_kb_stats()
Atomically update execution stats.

```sql
SELECT increment_rpa_kb_stats(
  step_id := 'uuid',
  is_success := true,
  execution_duration := 250,
  increment_appeared := true,
  increment_read := false
);
```

---

## Monitoring

### View Stats

```sql
SELECT * FROM rpa_kb_stats;
```

Returns:
- Total steps
- Steps with embeddings (by type)
- Average ranking
- Total executions (success/failure)
- Search appearances
- Read counts
- Table size

### Query Performance

```sql
-- Check index usage
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND relname = 'rpa_knowledgebase'
ORDER BY idx_scan DESC;

-- Check slow queries
SELECT query, calls, mean_exec_time, max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%rpa_knowledgebase%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## Cost Estimates

### Vertex AI Embeddings

**Per 10,000 steps:**
- 3 embeddings per step × ~100KB avg per embedding
- 10,000 × 300KB = 3GB = 3,000M characters
- 3,000 × $0.025 = **$75**

**Optimization tip:** If outcome diffs are consistently large, consider summarizing before embedding to reduce costs.

### Supabase

**For 1M steps:**
- Database size: ~100GB (with JSONB compression)
- Supabase Pro: $25-125/month depending on usage

### Total Monthly Cost

- Initial: ~$75 per 10K steps (one-time embedding cost)
- Ongoing: $25-150/month (database + new embeddings)

---

## Troubleshooting

### Embeddings not generating?

Check credentials:
```bash
echo $GOOGLE_CLIENT_EMAIL
echo $GOOGLE_CLOUD_PROJECT
```

Test manually:
```typescript
import { generateEmbedding } from '@/lib/vertex-embeddings';
const embedding = await generateEmbedding('test query');
console.log(embedding.length); // Should be 768
```

### Search returning empty?

1. Check if embeddings exist:
```sql
SELECT COUNT(*) FROM rpa_knowledgebase WHERE definition_embedding IS NOT NULL;
```

2. Test keyword search only (no embedding):
```sql
SELECT * FROM search_rpa_kb_keyword('button');
```

### Slow searches?

1. Check index usage:
```sql
EXPLAIN ANALYZE SELECT * FROM search_rpa_kb_two_stage('button');
```

2. Vacuum and analyze:
```sql
VACUUM ANALYZE rpa_knowledgebase;
```

---

## Next Steps

1. ✅ Run migration: `python3 local-scripts/setup_rpa_knowledgebase.py`
2. ✅ Test setup: `python3 local-scripts/test_rpa_kb_setup.py`
3. 🔄 Create steps via API: `POST /api/rpa-kb`
4. 🔍 Test search: `POST /api/rpa-kb/search`
5. 📊 Monitor performance: `SELECT * FROM rpa_kb_stats;`

---

## Files Created

```
supabase/migrations/
  └── 20260116000000_create_rpa_knowledgebase.sql (migration)

local-scripts/
  ├── setup_rpa_knowledgebase.py (setup script)
  ├── test_rpa_kb_setup.py (test script)
  └── RPA_KB_SETUP_README.md (this file)

src/lib/
  └── vertex-embeddings.ts (embedding helpers)

src/app/api/rpa-kb/
  ├── route.ts (create/list)
  ├── search/route.ts (two-stage search)
  ├── [id]/route.ts (get/update/delete)
  └── [id]/stats/route.ts (update execution stats)
```

---

**Questions? Issues?**
Check the migration SQL for detailed documentation on each function and index.

