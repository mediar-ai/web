import psycopg2
import os
import sys

def test_read_one_record(table_name):
    """Connects to the OLD database and tries to read a single record."""
    conn_string = os.environ.get("OLD_DB_CONN_STRING")
    if not conn_string:
        print("Error: OLD_DB_CONN_STRING environment variable not set.")
        sys.exit(1)

    try:
        print(f"Connecting to OLD database to test table: {table_name}...")
        conn = psycopg2.connect(conn_string)
        cur = conn.cursor()

        print(f"  > Attempting to read one record from {table_name}...")
        cur.execute(f"SELECT * FROM public.{table_name} LIMIT 1;")
        record = cur.fetchone()
        
        if record:
            print("\n✅ SUCCESS: Successfully read one record.")
            print("Record:", record)
        else:
            print("\n✅ SUCCESS: The table is readable, but it contains no records.")

    except Exception as e:
        print(f"\n❌ FAILED: An error occurred while trying to read from the table: {e}")
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()
        print("Database connection closed.")

if __name__ == "__main__":
    test_read_one_record("low_level_events") 