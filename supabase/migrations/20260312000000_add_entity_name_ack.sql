-- Track user acknowledgment of company name change from "Mediar, Inc." to "Mediar.ai, Inc."
ALTER TABLE mediar_users ADD COLUMN IF NOT EXISTS entity_name_ack_at timestamptz DEFAULT NULL;
