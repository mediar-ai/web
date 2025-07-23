#!/usr/bin/env python3
"""
Batched Client Timestamp Migration
Adds client_timestamp column and populates it in small batches to avoid timeouts
"""
import os
import psycopg2
from dotenv import load_dotenv
import time

load_dotenv('.env.local')

def main():
    conn = psycopg2.connect(os.getenv('SUPABASE_CONN_STRING'))
    conn.autocommit = True
    cur = conn.cursor()

    try:
        print('🚀 Starting batched client_timestamp migration...')
        
        # Step 1: Add column (fast operation)
        print('📝 Adding client_timestamp column...')
        cur.execute('ALTER TABLE public.low_level_events ADD COLUMN IF NOT EXISTS client_timestamp TIMESTAMPTZ;')
        print('✅ Column added')
        
        # Step 2: Create indexes (fast operation)
        print('📝 Creating indexes...')
        cur.execute('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_client_timestamp ON public.low_level_events(client_timestamp);')
        cur.execute('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_user_timestamp ON public.low_level_events(user_id, client_timestamp);')
        print('✅ Indexes created')
        
        # Step 3: Check how many records need updating
        cur.execute('SELECT COUNT(*) FROM low_level_events WHERE client_timestamp IS NULL')
        total_to_update = cur.fetchone()[0]
        print(f'📊 Records to update: {total_to_update:,}')
        
        if total_to_update == 0:
            print('✅ All records already have client_timestamp!')
            return
        
        # Step 4: Update in small batches
        batch_size = 1000
        updated = 0
        
        print(f'🔄 Updating in batches of {batch_size}...')
        
        while updated < total_to_update:
            # Update one batch
            cur.execute(f"""
                UPDATE public.low_level_events 
                SET client_timestamp = CASE 
                    WHEN payload->>'timestamp' IS NOT NULL 
                    THEN (payload->>'timestamp')::timestamptz
                    WHEN payload->'payload'->>'timestamp' IS NOT NULL 
                    THEN (payload->'payload'->>'timestamp')::timestamptz
                    ELSE created_at
                END
                WHERE id IN (
                    SELECT id FROM low_level_events 
                    WHERE client_timestamp IS NULL 
                    LIMIT {batch_size}
                )
            """)
            
            batch_updated = cur.rowcount
            updated += batch_updated
            
            print(f'   Updated {updated:,}/{total_to_update:,} records ({(updated/total_to_update)*100:.1f}%)')
            
            if batch_updated == 0:
                break
                
            # Small delay to avoid overwhelming the database
            time.sleep(0.1)
        
        print('✅ Data population completed!')
        
        # Verify results
        cur.execute('SELECT COUNT(*) as total, COUNT(client_timestamp) as populated FROM low_level_events')
        total, populated = cur.fetchone()
        print(f'📊 Final stats: {populated:,}/{total:,} events with client_timestamp')
        
    except Exception as e:
        print(f'❌ Error: {e}')
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    main() 