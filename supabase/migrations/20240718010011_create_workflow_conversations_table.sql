-- Create workflow_conversations table for storing chat history
CREATE TABLE workflow_conversations (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    synthesis_step TEXT DEFAULT 'idle',
    identified_workflow_names JSONB DEFAULT '[]'::jsonb,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster user lookups
CREATE INDEX idx_workflow_conversations_user_id ON workflow_conversations(user_id);
CREATE INDEX idx_workflow_conversations_updated_at ON workflow_conversations(updated_at DESC);

-- Add RLS (Row Level Security) policies if needed
ALTER TABLE workflow_conversations ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to access their own conversations
CREATE POLICY "Users can access their own conversations" ON workflow_conversations
    FOR ALL USING (auth.uid()::text = user_id); 