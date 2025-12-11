---
name: supabase-migrate
description: Run SQL migrations on Supabase database. Auto-activates when user says "run migration", "apply migration", "alter table", "add column", "create table", "migrate database", "schema change", or needs to modify database schema.
allowed-tools: Bash, Read
---

# Supabase Migration Skill

Run SQL migrations directly on the Mediar Supabase database using the Management API.

## ⚠️ CRITICAL SAFETY RULES

**ALL MIGRATIONS ARE DESTRUCTIVE** - Always confirm with user before executing!

1. Show the exact SQL that will be executed
2. Ask: "This will modify the database schema. Confirm: yes/no?"
3. Only proceed if user explicitly confirms
4. Always verify the result after execution

---

## Configuration

**Required Environment Variables (from `apps/web/.env.local`):**
- `SUPABASE_ACCESS_TOKEN` - Management API access token (sbp_...)
- `SUPABASE_URL` - Database URL (to extract project ref)

**Project Reference:** `eshwntsgsputksqamckh`

---

## Running Migrations

### Pattern for Running SQL

```bash
# Run any SQL statement via Supabase Management API
curl -s "https://api.supabase.com/v1/projects/eshwntsgsputksqamckh/database/query" \
  -X POST \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "YOUR SQL STATEMENT HERE"}'
```

### Example: Add Column

```bash
curl -s "https://api.supabase.com/v1/projects/eshwntsgsputksqamckh/database/query" \
  -X POST \
  -H "Authorization: Bearer sbp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"query": "ALTER TABLE my_table ADD COLUMN IF NOT EXISTS new_column TEXT;"}'
```

### Example: Create Table

```bash
curl -s "https://api.supabase.com/v1/projects/eshwntsgsputksqamckh/database/query" \
  -X POST \
  -H "Authorization: Bearer sbp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE TABLE IF NOT EXISTS my_table (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());"}'
```

### Example: Add Index

```bash
curl -s "https://api.supabase.com/v1/projects/eshwntsgsputksqamckh/database/query" \
  -X POST \
  -H "Authorization: Bearer sbp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE INDEX IF NOT EXISTS idx_my_table_name ON my_table(name);"}'
```

---

## Reading Access Token

```bash
cd C:/Users/louis030195/Documents/mediar-web-app
grep "^SUPABASE_ACCESS_TOKEN=" apps/web/.env.local | sed 's/SUPABASE_ACCESS_TOKEN=//' | tr -d '"'
```

---

## Verifying Migration Success

After running a migration, verify it worked:

### Check Column Exists
```bash
SUPABASE_URL="https://eshwntsgsputksqamckh.supabase.co"
SUPABASE_KEY="YOUR_SERVICE_ROLE_KEY"
curl -s "${SUPABASE_URL}/rest/v1/TABLE_NAME?select=COLUMN_NAME&limit=1" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}"
```

### Check Table Exists
```bash
curl -s "https://api.supabase.com/v1/projects/eshwntsgsputksqamckh/database/query" \
  -X POST \
  -H "Authorization: Bearer sbp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT table_name FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_name = '\''my_table'\'';"}'
```

---

## Response Codes

- `[]` (empty array) - Success for DDL statements (CREATE, ALTER, DROP)
- `[{...}]` - Success with data for SELECT statements
- `{"code": "...", "message": "..."}` - Error

---

## Common Migrations

### Add Column with Default
```sql
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name TYPE DEFAULT value;
```

### Add NOT NULL Column (requires default)
```sql
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name TYPE NOT NULL DEFAULT value;
```

### Rename Column
```sql
ALTER TABLE table_name RENAME COLUMN old_name TO new_name;
```

### Drop Column
```sql
ALTER TABLE table_name DROP COLUMN IF EXISTS column_name;
```

### Add Foreign Key
```sql
ALTER TABLE table_name ADD CONSTRAINT fk_name FOREIGN KEY (column) REFERENCES other_table(id);
```

### Create Index
```sql
CREATE INDEX IF NOT EXISTS idx_name ON table_name(column);
```

### Create Unique Constraint
```sql
ALTER TABLE table_name ADD CONSTRAINT unique_name UNIQUE (column);
```

---

## Important Notes

1. **Local migration files are NOT synced** - Run migrations via this API directly
2. **Always use IF NOT EXISTS / IF EXISTS** - Makes migrations idempotent
3. **Test on staging first** - If available
4. **Backup consideration** - Supabase has point-in-time recovery, but be careful with destructive operations
5. **RLS policies** - May need to be updated separately after schema changes
