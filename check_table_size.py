import os
import psycopg2
from dotenv import load_dotenv

load_dotenv('.env.local')
conn = psycopg2.connect(os.getenv('SUPABASE_CONN_STRING'))
cur = conn.cursor()

# Check table size
cur.execute('SELECT COUNT(*) FROM low_level_events')
count = cur.fetchone()[0]
print(f'Total events: {count:,}')

# Check if column exists
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'low_level_events' AND column_name = 'client_timestamp'")
exists = cur.fetchone()
print(f'client_timestamp column exists: {bool(exists)}')

cur.close()
conn.close() 