#!/usr/bin/env python3
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv('.env.local')

conn = psycopg2.connect(os.getenv('SUPABASE_CONN_STRING'))
conn.autocommit = True
cur = conn.cursor()

try:
    print('Adding client_timestamp column...')
    cur.execute('ALTER TABLE public.low_level_events ADD COLUMN IF NOT EXISTS client_timestamp TIMESTAMPTZ;')
    print('Column added successfully')
    
    print('Creating indexes...')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_low_level_events_client_timestamp ON public.low_level_events(client_timestamp);')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_low_level_events_user_timestamp ON public.low_level_events(user_id, client_timestamp);')
    print('Indexes created successfully')
    
    print('Populating existing data...')
    cur.execute("""
        UPDATE public.low_level_events 
        SET client_timestamp = CASE 
            WHEN payload->>'timestamp' IS NOT NULL 
            THEN (payload->>'timestamp')::timestamptz
            WHEN payload->'payload'->>'timestamp' IS NOT NULL 
            THEN (payload->'payload'->>'timestamp')::timestamptz
            ELSE created_at
        END
        WHERE client_timestamp IS NULL
    """)
    print('Data populated successfully')
    
    # Check results
    cur.execute("SELECT COUNT(*) as total, COUNT(client_timestamp) as populated FROM low_level_events")
    total, populated = cur.fetchone()
    print(f'Total events: {total}, With client_timestamp: {populated}')
    
except Exception as e:
    print(f'Error: {e}')
finally:
    cur.close()
    conn.close()

print('Migration completed!') 