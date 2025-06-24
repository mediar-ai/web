import psycopg2
import psycopg2.extras
import os

OLD_DB = os.environ["OLD_DB_CONN_STRING"]
NEW_DB = os.environ["NEW_DB_CONN_STRING"]

table = "low_level_events"

with psycopg2.connect(OLD_DB) as old_conn, psycopg2.connect(NEW_DB) as new_conn:
    old_cur = old_conn.cursor()
    new_cur = new_conn.cursor()

    # Fetch a single row from the old table
    old_cur.execute(f"SELECT * FROM public.{table} LIMIT 1;")
    row = old_cur.fetchone()
    if not row:
        print("No rows found in old table.")
        exit(0)

    # Get column names
    old_cur.execute(f"SELECT * FROM public.{table} LIMIT 0;")
    colnames = [desc[0] for desc in old_cur.description]

    # Convert dicts to Json for JSONB columns
    row = tuple(psycopg2.extras.Json(v) if isinstance(v, dict) else v for v in row)

    # Prepare the insert statement
    placeholders = ', '.join(['%s'] * len(colnames))
    insert_sql = f"INSERT INTO public.{table} ({', '.join(colnames)}) VALUES ({placeholders})"

    # Insert into the new table (truncate for test)
    new_cur.execute(f"TRUNCATE public.{table} RESTART IDENTITY CASCADE;")
    new_cur.execute(insert_sql, row)
    new_conn.commit()
    print("✅ Successfully copied one row to the new database.") 