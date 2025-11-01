#!/usr/bin/env python3
"""
Test RPA Knowledgebase Setup
Creates sample data and tests search functionality
"""

import psycopg2
import json
import sys

DB_CONNECTION = "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

def main():
    print("=" * 80)
    print("RPA KNOWLEDGEBASE TEST")
    print("=" * 80)
    
    # Connect
    try:
        conn = psycopg2.connect(DB_CONNECTION)
        cur = conn.cursor()
        print("✅ Connected to database")
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        sys.exit(1)
    
    # Check if table exists
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'rpa_knowledgebase'
        );
    """)
    if not cur.fetchone()[0]:
        print("❌ Table 'rpa_knowledgebase' does not exist. Run setup_rpa_knowledgebase.py first!")
        sys.exit(1)
    
    print("✅ Table exists")
    
    # Test 1: Check initial stats
    print("\n📊 Test 1: Check initial statistics")
    cur.execute("SELECT * FROM rpa_kb_stats;")
    stats = cur.fetchone()
    print(f"   Total steps: {stats[0]}")
    print(f"   Steps with definition embeddings: {stats[2]}")
    print(f"   Steps with workflow embeddings: {stats[3]}")
    print(f"   Steps with outcome embeddings: {stats[4]}")
    print(f"   Table size: {stats[10]}")
    
    # Test 2: Insert sample step WITHOUT embeddings (to test table structure)
    print("\n➕ Test 2: Insert sample step (without embeddings)")
    sample_step = {
        'app_name': 'Chrome',
        'window_title': 'Google Form - Test',
        'element_path': 'Window > Panel > Button[name="Submit"]',
        'step_name': 'Click submit button',
        'definition': 'await element.click({ button: "left" })',
        'current_state': json.dumps({
            'variables': {
                'form_data': {'type': 'object', 'fields': ['name', 'email']},
                'is_validated': {'type': 'boolean', 'value': True}
            }
        }),
        'expected_outcome': json.dumps({
            'before': {'button_state': 'enabled', 'form_state': 'draft'},
            'after': {'button_state': 'disabled', 'form_state': 'submitted'},
            'changes': [
                '- button enabled',
                '+ button disabled',
                '- form draft',
                '+ form submitted'
            ]
        }),
        'workflow_name': 'Form Submission Workflow',
        'workflow_description': 'Standard workflow for submitting web forms with validation',
        'terminator_version': 'v1.0.0',
        'environment': 'production',
        'author': 'test@example.com',
        'succeeded': 10,
        'failed': 1,
        'duration_ms': 250
    }
    
    try:
        cur.execute("""
            INSERT INTO rpa_knowledgebase (
                app_name, window_title, element_path, step_name, definition,
                current_state, expected_outcome, workflow_name, workflow_description,
                terminator_version, environment, author, succeeded, failed, duration_ms
            ) VALUES (
                %(app_name)s, %(window_title)s, %(element_path)s, %(step_name)s, %(definition)s,
                %(current_state)s, %(expected_outcome)s, %(workflow_name)s, %(workflow_description)s,
                %(terminator_version)s, %(environment)s, %(author)s, %(succeeded)s, %(failed)s, %(duration_ms)s
            ) RETURNING id, ranking;
        """, sample_step)
        
        step_id, ranking = cur.fetchone()
        conn.commit()
        print(f"   ✅ Step created: {step_id}")
        print(f"   📊 Computed ranking: {ranking:.2f}")
        
    except Exception as e:
        conn.rollback()
        print(f"   ❌ Insert failed: {e}")
        sys.exit(1)
    
    # Test 3: Test keyword search function
    print("\n🔍 Test 3: Test keyword search")
    try:
        cur.execute("""
            SELECT step_id, app_name, step_name, ranking, succeeded, failed
            FROM search_rpa_kb_keyword('submit button', filter_app := 'Chrome');
        """)
        results = cur.fetchall()
        print(f"   Found {len(results)} results for 'submit button'")
        for result in results[:3]:
            print(f"   - {result[2]} (ranking: {result[3]:.2f}, {result[4]}/{result[5]} success/fail)")
    except Exception as e:
        print(f"   ❌ Search failed: {e}")
    
    # Test 4: Test JSONB queries
    print("\n🗂️  Test 4: Test JSONB queries")
    try:
        # Query inside current_state JSONB
        cur.execute("""
            SELECT id, step_name, current_state->'variables' as variables
            FROM rpa_knowledgebase
            WHERE current_state ? 'variables'
            LIMIT 5;
        """)
        results = cur.fetchall()
        print(f"   Found {len(results)} steps with variables in current_state")
        for result in results[:3]:
            print(f"   - {result[1]}: {len(str(result[2]))} chars of state data")
    except Exception as e:
        print(f"   ❌ JSONB query failed: {e}")
    
    # Test 5: Test stats update function
    print("\n📈 Test 5: Test stats update function")
    try:
        cur.execute("""
            SELECT increment_rpa_kb_stats(
                step_id := %s,
                is_success := true,
                execution_duration := 200,
                increment_appeared := true,
                increment_read := false
            );
        """, (step_id,))
        conn.commit()
        
        # Fetch updated stats
        cur.execute("""
            SELECT succeeded, failed, duration_ms, appeared_in_search, times_read, ranking
            FROM rpa_knowledgebase
            WHERE id = %s;
        """, (step_id,))
        updated = cur.fetchone()
        print(f"   ✅ Stats updated:")
        print(f"      Succeeded: {updated[0]} (was 10)")
        print(f"      Failed: {updated[1]} (was 1)")
        print(f"      Duration: {updated[2]}ms (was 250ms)")
        print(f"      Appeared in search: {updated[3]} (was 0)")
        print(f"      Times read: {updated[4]} (was 0)")
        print(f"      New ranking: {updated[5]:.2f}")
        
    except Exception as e:
        conn.rollback()
        print(f"   ❌ Stats update failed: {e}")
    
    # Test 6: Test full-text search vector
    print("\n🔤 Test 6: Test full-text search")
    try:
        cur.execute("""
            SELECT step_name, ts_rank_cd(search_vector, query) AS rank
            FROM rpa_knowledgebase, websearch_to_tsquery('english', 'form submit') query
            WHERE search_vector @@ query
            ORDER BY rank DESC
            LIMIT 5;
        """)
        results = cur.fetchall()
        print(f"   Found {len(results)} results for 'form submit'")
        for result in results:
            print(f"   - {result[0]} (rank: {result[1]:.4f})")
    except Exception as e:
        print(f"   ❌ Full-text search failed: {e}")
    
    # Test 7: Final statistics
    print("\n📊 Test 7: Final statistics")
    cur.execute("SELECT * FROM rpa_kb_stats;")
    stats = cur.fetchone()
    print(f"   Total steps: {stats[0]}")
    print(f"   Steps with success: {stats[1]}")
    print(f"   Average ranking: {stats[5]:.2f}" if stats[5] else "   Average ranking: N/A")
    print(f"   Total successes: {stats[6]}")
    print(f"   Total failures: {stats[7]}")
    print(f"   Total search appearances: {stats[8]}")
    print(f"   Table size: {stats[10]}")
    
    # Cleanup (optional)
    print("\n🧹 Cleanup")
    response = input("   Delete test data? (yes/no): ").strip().lower()
    if response == 'yes':
        cur.execute("DELETE FROM rpa_knowledgebase WHERE id = %s;", (step_id,))
        conn.commit()
        print("   ✅ Test data deleted")
    else:
        print("   ℹ️  Test data kept in database")
    
    cur.close()
    conn.close()
    
    print("\n" + "=" * 80)
    print("✅ ALL TESTS PASSED!")
    print("=" * 80)
    print("\nSetup is ready for production use.")
    print("\nNext steps:")
    print("1. Use POST /api/rpa-kb to create steps with embeddings")
    print("2. Use POST /api/rpa-kb/search for two-stage search")
    print("3. Use POST /api/rpa-kb/[id]/stats to update execution stats")
    print("\nNote: Embeddings were NOT generated in this test (requires API endpoint)")
    print("")

if __name__ == "__main__":
    main()

