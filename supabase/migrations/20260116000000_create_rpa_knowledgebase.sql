-- Migration: Create RPA Knowledgebase System
-- Description: Two-stage search system (keyword + vector similarity) for workflow step knowledge
-- Created: 2025-01-16
-- Author: AI Assistant

-- ============================================================================
-- PART 1: ENABLE REQUIRED EXTENSIONS
-- ============================================================================

-- Enable vector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for full-text search optimization
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable pg_stat_statements if not already enabled (for monitoring)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================================
-- PART 2: CREATE MAIN TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_knowledgebase (
  -- ===== Identity =====
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- ===== Core Identifiers =====
  app_name TEXT NOT NULL,
  window_title TEXT NOT NULL,
  element_path TEXT NOT NULL,
  
  -- ===== Step Definition =====
  step_name TEXT NOT NULL,
  definition TEXT,  -- Code snippet that defines how to perform this step
  
  -- ===== Execution Statistics =====
  succeeded INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  duration_ms INTEGER,  -- Average duration in milliseconds
  
  -- ===== Usage Analytics =====
  appeared_in_search INTEGER DEFAULT 0,  -- How many times this step appeared in search results
  times_read INTEGER DEFAULT 0,  -- How many times this step was viewed/read
  
  -- ===== Computed Ranking (Static, updated via trigger) =====
  -- Formula: 40% success rate + 30% frequency + 10% speed
  -- Note: Recency component removed from generated column (not immutable)
  -- Use a trigger or periodic job to update ranking with recency
  ranking NUMERIC DEFAULT 0,
  
  -- ===== State & Outcome (JSONB Storage) =====
  current_state JSONB,  -- Variable names, types, values at execution time
  expected_outcome JSONB,  -- Before/after UI tree, HTML DOM diffs (YAML/JSON format, ~2K lines)
  
  -- ===== Metadata =====
  workflow_name TEXT NOT NULL,
  workflow_description TEXT,
  terminator_version TEXT,
  environment TEXT,  -- e.g., 'production', 'staging', 'development'
  author TEXT,
  
  -- ===== Timestamps =====
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_executed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- ===== Vector Embeddings (768 dimensions for Vertex AI text-embedding-004) =====
  definition_embedding vector(768),  -- Embedding of step definition + step_name
  workflow_embedding vector(768),    -- Embedding of workflow_name + workflow_description
  outcome_embedding vector(768),     -- Embedding of full expected_outcome (for UI similarity search)
  
  -- ===== Full-Text Search Vector (Auto-generated) =====
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(app_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(window_title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(step_name, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(element_path, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(workflow_name, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(definition, '')), 'D')
  ) STORED
);

-- Add table and column comments for documentation
COMMENT ON TABLE rpa_knowledgebase IS 'RPA workflow step knowledgebase with two-stage search (keyword + vector similarity)';
COMMENT ON COLUMN rpa_knowledgebase.ranking IS 'Auto-computed score: 40% success rate + 30% frequency + 20% recency + 10% speed';
COMMENT ON COLUMN rpa_knowledgebase.search_vector IS 'Full-text search with priority: app_name (A=1.0) > window_title (A=1.0) > step_name (B=0.4) > element_path (B=0.4) > workflow_name (C=0.2) > definition (D=0.1)';
COMMENT ON COLUMN rpa_knowledgebase.current_state IS 'Variable names, types, values at execution time (JSONB)';
COMMENT ON COLUMN rpa_knowledgebase.expected_outcome IS 'Before/after UI tree diffs in YAML/JSON format (~2K lines, JSONB)';
COMMENT ON COLUMN rpa_knowledgebase.definition_embedding IS 'Vector embedding (768d) of step definition for similarity search';
COMMENT ON COLUMN rpa_knowledgebase.workflow_embedding IS 'Vector embedding (768d) of workflow context for similarity search';
COMMENT ON COLUMN rpa_knowledgebase.outcome_embedding IS 'Vector embedding (768d) of UI outcome for similarity search';

-- ============================================================================
-- PART 3: CREATE INDEXES
-- ============================================================================

-- Primary search indexes (for filtering)
CREATE INDEX idx_rpa_kb_app ON rpa_knowledgebase(app_name);
CREATE INDEX idx_rpa_kb_window ON rpa_knowledgebase(window_title);
CREATE INDEX idx_rpa_kb_app_window ON rpa_knowledgebase(app_name, window_title);
CREATE INDEX idx_rpa_kb_workflow ON rpa_knowledgebase(workflow_name);
CREATE INDEX idx_rpa_kb_author ON rpa_knowledgebase(author);
CREATE INDEX idx_rpa_kb_environment ON rpa_knowledgebase(environment);

-- Ranking index (for sorting)
CREATE INDEX idx_rpa_kb_ranking ON rpa_knowledgebase(ranking DESC);

-- Full-text search index (GIN for tsvector)
CREATE INDEX idx_rpa_kb_search_vector ON rpa_knowledgebase USING GIN(search_vector);

-- Timestamp indexes (for date filtering)
CREATE INDEX idx_rpa_kb_created_at ON rpa_knowledgebase(created_at DESC);
CREATE INDEX idx_rpa_kb_last_executed ON rpa_knowledgebase(last_executed_at DESC);

-- Vector similarity indexes (HNSW for fast cosine similarity search)
CREATE INDEX idx_rpa_kb_definition_embedding ON rpa_knowledgebase 
  USING hnsw (definition_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_rpa_kb_workflow_embedding ON rpa_knowledgebase 
  USING hnsw (workflow_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_rpa_kb_outcome_embedding ON rpa_knowledgebase 
  USING hnsw (outcome_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- JSONB indexes (GIN for querying inside JSONB fields)
CREATE INDEX idx_rpa_kb_current_state ON rpa_knowledgebase USING GIN(current_state);
CREATE INDEX idx_rpa_kb_expected_outcome ON rpa_knowledgebase USING GIN(expected_outcome);

-- Deduplication index (for finding existing steps by app + element_path + definition)
CREATE INDEX idx_rpa_kb_dedup ON rpa_knowledgebase(app_name, element_path, definition);

-- ============================================================================
-- PART 4: CREATE SEARCH FUNCTIONS
-- ============================================================================

-- -----------------------------------------------------------------------------
-- Function 1: Stage 1 - Keyword Search with Filters
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_rpa_kb_keyword(
  search_query TEXT DEFAULT NULL,
  filter_app TEXT DEFAULT NULL,
  filter_window TEXT DEFAULT NULL,
  filter_workflow TEXT DEFAULT NULL,
  filter_author TEXT DEFAULT NULL,
  filter_environment TEXT DEFAULT NULL,
  date_from TIMESTAMPTZ DEFAULT NULL,
  date_to TIMESTAMPTZ DEFAULT NULL,
  min_succeeded INTEGER DEFAULT 0,
  result_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  step_id UUID,
  app_name TEXT,
  window_title TEXT,
  step_name TEXT,
  workflow_name TEXT,
  ranking NUMERIC,
  succeeded INTEGER,
  failed INTEGER,
  last_executed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    kb.id,
    kb.app_name,
    kb.window_title,
    kb.step_name,
    kb.workflow_name,
    kb.ranking,
    kb.succeeded,
    kb.failed,
    kb.last_executed_at
  FROM rpa_knowledgebase kb
  WHERE 
    -- Full-text search (if query provided)
    (search_query IS NULL OR kb.search_vector @@ websearch_to_tsquery('english', search_query))
    -- Metadata filters
    AND (filter_app IS NULL OR kb.app_name = filter_app)
    AND (filter_window IS NULL OR kb.window_title = filter_window)
    AND (filter_workflow IS NULL OR kb.workflow_name = filter_workflow)
    AND (filter_author IS NULL OR kb.author = filter_author)
    AND (filter_environment IS NULL OR kb.environment = filter_environment)
    -- Date range
    AND (date_from IS NULL OR kb.last_executed_at >= date_from)
    AND (date_to IS NULL OR kb.last_executed_at <= date_to)
    -- Quality filter
    AND kb.succeeded >= min_succeeded
  ORDER BY 
    kb.ranking DESC,
    ts_rank_cd(kb.search_vector, websearch_to_tsquery('english', COALESCE(search_query, ''))) DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION search_rpa_kb_keyword IS 'Stage 1: Keyword search with metadata filters. Returns top N step IDs ranked by quality.';

-- -----------------------------------------------------------------------------
-- Function 2: Stage 2 - Vector Similarity Search
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_rpa_kb_similarity(
  step_ids UUID[],
  query_embedding vector(768),
  embedding_type TEXT DEFAULT 'definition',  -- 'definition', 'workflow', or 'outcome'
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  step_id UUID,
  app_name TEXT,
  window_title TEXT,
  step_name TEXT,
  definition TEXT,
  workflow_name TEXT,
  ranking NUMERIC,
  similarity_score NUMERIC
) AS $$
BEGIN
  -- Search based on embedding type
  IF embedding_type = 'definition' THEN
    RETURN QUERY
    SELECT 
      kb.id,
      kb.app_name,
      kb.window_title,
      kb.step_name,
      kb.definition,
      kb.workflow_name,
      kb.ranking,
      (1 - (kb.definition_embedding <=> query_embedding))::NUMERIC as similarity_score
    FROM rpa_knowledgebase kb
    WHERE 
      kb.id = ANY(step_ids)
      AND kb.definition_embedding IS NOT NULL
    ORDER BY kb.definition_embedding <=> query_embedding
    LIMIT result_limit;
    
  ELSIF embedding_type = 'workflow' THEN
    RETURN QUERY
    SELECT 
      kb.id,
      kb.app_name,
      kb.window_title,
      kb.step_name,
      kb.definition,
      kb.workflow_name,
      kb.ranking,
      (1 - (kb.workflow_embedding <=> query_embedding))::NUMERIC as similarity_score
    FROM rpa_knowledgebase kb
    WHERE 
      kb.id = ANY(step_ids)
      AND kb.workflow_embedding IS NOT NULL
    ORDER BY kb.workflow_embedding <=> query_embedding
    LIMIT result_limit;
    
  ELSIF embedding_type = 'outcome' THEN
    RETURN QUERY
    SELECT 
      kb.id,
      kb.app_name,
      kb.window_title,
      kb.step_name,
      kb.definition,
      kb.workflow_name,
      kb.ranking,
      (1 - (kb.outcome_embedding <=> query_embedding))::NUMERIC as similarity_score
    FROM rpa_knowledgebase kb
    WHERE 
      kb.id = ANY(step_ids)
      AND kb.outcome_embedding IS NOT NULL
    ORDER BY kb.outcome_embedding <=> query_embedding
    LIMIT result_limit;
    
  ELSE
    RAISE EXCEPTION 'Invalid embedding_type: %. Must be definition, workflow, or outcome.', embedding_type;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION search_rpa_kb_similarity IS 'Stage 2: Vector similarity search within filtered step IDs. Supports definition, workflow, or outcome similarity.';

-- -----------------------------------------------------------------------------
-- Function 3: Combined Two-Stage Search
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_rpa_kb_two_stage(
  search_query TEXT DEFAULT NULL,
  query_embedding vector(768) DEFAULT NULL,
  embedding_type TEXT DEFAULT 'definition',
  filter_app TEXT DEFAULT NULL,
  filter_window TEXT DEFAULT NULL,
  filter_workflow TEXT DEFAULT NULL,
  filter_author TEXT DEFAULT NULL,
  filter_environment TEXT DEFAULT NULL,
  stage1_limit INTEGER DEFAULT 500,
  stage2_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  step_id UUID,
  app_name TEXT,
  window_title TEXT,
  step_name TEXT,
  definition TEXT,
  workflow_name TEXT,
  ranking NUMERIC,
  keyword_rank INTEGER,
  similarity_score NUMERIC,
  combined_score NUMERIC
) AS $$
DECLARE
  filtered_ids UUID[];
BEGIN
  -- Stage 1: Keyword search
  SELECT ARRAY_AGG(id) INTO filtered_ids
  FROM (
    SELECT kb.id
    FROM rpa_knowledgebase kb
    WHERE 
      (search_query IS NULL OR kb.search_vector @@ websearch_to_tsquery('english', search_query))
      AND (filter_app IS NULL OR kb.app_name = filter_app)
      AND (filter_window IS NULL OR kb.window_title = filter_window)
      AND (filter_workflow IS NULL OR kb.workflow_name = filter_workflow)
      AND (filter_author IS NULL OR kb.author = filter_author)
      AND (filter_environment IS NULL OR kb.environment = filter_environment)
    ORDER BY kb.ranking DESC
    LIMIT stage1_limit
  ) stage1_results;

  -- If no results from stage 1, return empty
  IF filtered_ids IS NULL OR array_length(filtered_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- Stage 2: Vector similarity (if embedding provided)
  IF query_embedding IS NOT NULL THEN
    -- With similarity search
    IF embedding_type = 'definition' THEN
      RETURN QUERY
      SELECT 
        kb.id,
        kb.app_name,
        kb.window_title,
        kb.step_name,
        kb.definition,
        kb.workflow_name,
        kb.ranking,
        NULL::INTEGER as keyword_rank,
        (1 - (kb.definition_embedding <=> query_embedding))::NUMERIC as similarity_score,
        (kb.ranking * 0.003 + (1 - (kb.definition_embedding <=> query_embedding)) * 0.7)::NUMERIC as combined_score
      FROM rpa_knowledgebase kb
      WHERE 
        kb.id = ANY(filtered_ids)
        AND kb.definition_embedding IS NOT NULL
      ORDER BY combined_score DESC
      LIMIT stage2_limit;
      
    ELSIF embedding_type = 'workflow' THEN
      RETURN QUERY
      SELECT 
        kb.id,
        kb.app_name,
        kb.window_title,
        kb.step_name,
        kb.definition,
        kb.workflow_name,
        kb.ranking,
        NULL::INTEGER as keyword_rank,
        (1 - (kb.workflow_embedding <=> query_embedding))::NUMERIC as similarity_score,
        (kb.ranking * 0.003 + (1 - (kb.workflow_embedding <=> query_embedding)) * 0.7)::NUMERIC as combined_score
      FROM rpa_knowledgebase kb
      WHERE 
        kb.id = ANY(filtered_ids)
        AND kb.workflow_embedding IS NOT NULL
      ORDER BY combined_score DESC
      LIMIT stage2_limit;
      
    ELSIF embedding_type = 'outcome' THEN
      RETURN QUERY
      SELECT 
        kb.id,
        kb.app_name,
        kb.window_title,
        kb.step_name,
        kb.definition,
        kb.workflow_name,
        kb.ranking,
        NULL::INTEGER as keyword_rank,
        (1 - (kb.outcome_embedding <=> query_embedding))::NUMERIC as similarity_score,
        (kb.ranking * 0.003 + (1 - (kb.outcome_embedding <=> query_embedding)) * 0.7)::NUMERIC as combined_score
      FROM rpa_knowledgebase kb
      WHERE 
        kb.id = ANY(filtered_ids)
        AND kb.outcome_embedding IS NOT NULL
      ORDER BY combined_score DESC
      LIMIT stage2_limit;
    END IF;
    
  ELSE
    -- No embedding: return keyword results only
    RETURN QUERY
    SELECT 
      kb.id,
      kb.app_name,
      kb.window_title,
      kb.step_name,
      kb.definition,
      kb.workflow_name,
      kb.ranking,
      ROW_NUMBER() OVER ()::INTEGER as keyword_rank,
      NULL::NUMERIC as similarity_score,
      (kb.ranking / 100.0)::NUMERIC as combined_score
    FROM rpa_knowledgebase kb
    WHERE kb.id = ANY(filtered_ids)
    ORDER BY kb.ranking DESC
    LIMIT stage2_limit;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION search_rpa_kb_two_stage IS 'Combined two-stage search: Stage 1 filters by keywords, Stage 2 ranks by vector similarity. Returns top N most relevant steps.';

-- -----------------------------------------------------------------------------
-- Function 4: Increment Step Statistics (Atomic Updates)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_rpa_kb_stats(
  step_id UUID,
  is_success BOOLEAN DEFAULT NULL,
  execution_duration INTEGER DEFAULT NULL,
  increment_appeared BOOLEAN DEFAULT FALSE,
  increment_read BOOLEAN DEFAULT FALSE
) RETURNS void AS $$
BEGIN
  UPDATE rpa_knowledgebase
  SET 
    -- Update execution stats
    succeeded = CASE WHEN is_success = TRUE THEN succeeded + 1 ELSE succeeded END,
    failed = CASE WHEN is_success = FALSE THEN failed + 1 ELSE failed END,
    duration_ms = CASE 
      WHEN execution_duration IS NOT NULL AND duration_ms IS NULL THEN execution_duration
      WHEN execution_duration IS NOT NULL THEN (duration_ms * 0.8 + execution_duration * 0.2)::INTEGER  -- Exponential moving average
      ELSE duration_ms
    END,
    last_executed_at = CASE 
      WHEN is_success IS NOT NULL THEN NOW() 
      ELSE last_executed_at 
    END,
    -- Update usage stats
    appeared_in_search = CASE WHEN increment_appeared THEN appeared_in_search + 1 ELSE appeared_in_search END,
    times_read = CASE WHEN increment_read THEN times_read + 1 ELSE times_read END
  WHERE id = step_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_rpa_kb_stats IS 'Atomically update step statistics: execution results, duration (moving average), and usage counts.';

-- -----------------------------------------------------------------------------
-- Function 5: Calculate Ranking (with recency)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_ranking(
  p_succeeded INTEGER,
  p_failed INTEGER,
  p_duration_ms INTEGER,
  p_last_executed_at TIMESTAMPTZ
) RETURNS NUMERIC AS $$
BEGIN
  IF (p_succeeded + p_failed) = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN (
    -- Success rate component (40%)
    (p_succeeded::NUMERIC / (p_succeeded + p_failed)) * 0.4 +
    -- Frequency component normalized to 100 executions (30%)
    LEAST((p_succeeded + p_failed)::NUMERIC / 100, 1.0) * 0.3 +
    -- Recency score - decays over 30 days (20%)
    GREATEST(1.0 - (EXTRACT(EPOCH FROM (NOW() - p_last_executed_at)) / 2592000), 0) * 0.2 +
    -- Speed score - faster is better (10%)
    CASE 
      WHEN p_duration_ms > 0 THEN LEAST(1000.0 / p_duration_ms, 1.0) * 0.1 
      ELSE 0 
    END
  ) * 100;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_ranking IS 'Calculate ranking score based on success rate, frequency, recency, and speed';

-- -----------------------------------------------------------------------------
-- Trigger: Auto-update ranking on insert/update
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_ranking_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.ranking := calculate_ranking(
    NEW.succeeded,
    NEW.failed,
    NEW.duration_ms,
    NEW.last_executed_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ranking
  BEFORE INSERT OR UPDATE ON rpa_knowledgebase
  FOR EACH ROW
  EXECUTE FUNCTION update_ranking_trigger();

COMMENT ON TRIGGER trigger_update_ranking ON rpa_knowledgebase IS 'Automatically recalculate ranking on insert/update';

-- ============================================================================
-- PART 5: CREATE HELPER VIEWS
-- ============================================================================

-- Monitoring view for knowledgebase statistics
CREATE OR REPLACE VIEW rpa_kb_stats AS
SELECT 
  COUNT(*) as total_steps,
  COUNT(*) FILTER (WHERE succeeded > 0) as steps_with_success,
  COUNT(*) FILTER (WHERE definition_embedding IS NOT NULL) as steps_with_definition_embedding,
  COUNT(*) FILTER (WHERE workflow_embedding IS NOT NULL) as steps_with_workflow_embedding,
  COUNT(*) FILTER (WHERE outcome_embedding IS NOT NULL) as steps_with_outcome_embedding,
  AVG(ranking) as avg_ranking,
  SUM(succeeded) as total_successes,
  SUM(failed) as total_failures,
  SUM(appeared_in_search) as total_search_appearances,
  SUM(times_read) as total_reads,
  pg_size_pretty(pg_total_relation_size('rpa_knowledgebase')) as table_size
FROM rpa_knowledgebase;

COMMENT ON VIEW rpa_kb_stats IS 'Monitoring view showing aggregate statistics for the RPA knowledgebase';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Log successful migration
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'Created table: rpa_knowledgebase';
  RAISE NOTICE 'Created indexes: 16 total (3 HNSW vector, 2 GIN JSONB, 1 GIN tsvector, 1 dedup, 9 B-tree)';
  RAISE NOTICE 'Created functions: 5 (search functions + calculate_ranking + increment_stats)';
  RAISE NOTICE 'Created trigger: 1 (auto-update ranking)';
  RAISE NOTICE 'Created views: 1 (rpa_kb_stats)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Generate embeddings using Vertex AI text-embedding-004';
  RAISE NOTICE '2. Create API endpoints for CRUD + search';
  RAISE NOTICE '3. Test two-stage search with sample data';
END $$;

