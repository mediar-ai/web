#!/usr/bin/env python3
"""
Get Actual Quote Results

This script retrieves actual execution results and quotes from successful executions
to show what data would be cached and returned instantly.
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import json

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    # Use the same connection string as the working check_recent_executions.py script
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    return conn

def show_execution_details(cur, execution_id):
    """Show detailed execution results including quotes."""
    print(f"\n🔍 DETAILED EXECUTION ANALYSIS: {execution_id}")
    print("=" * 60)
    
    cur.execute("""
        SELECT id, workflow_id, execution_params, results, formatted_output,
               created_at, started_at, completed_at, execution_duration_seconds,
               status, client_id, modal_call_id
        FROM workflow_executions 
        WHERE id = %s
    """, (execution_id,))
    
    execution = cur.fetchone()
    
    if not execution:
        print(f"❌ Execution {execution_id} not found")
        return
    
    print(f"📊 EXECUTION METADATA:")
    print(f"   ID: {execution['id']}")
    print(f"   Workflow: {execution['workflow_id']}")
    print(f"   Status: {execution['status']}")
    print(f"   Duration: {execution['execution_duration_seconds']}s")
    print(f"   Created: {execution['created_at']}")
    print(f"   Client: {execution['client_id']}")
    print(f"   Modal Call: {execution['modal_call_id']}")
    
    print(f"\n📥 INPUT PARAMETERS:")
    if execution['execution_params']:
        params = execution['execution_params']
        print(json.dumps(params, indent=2))
    
    print(f"\n💰 FORMATTED QUOTES OUTPUT:")
    if execution['formatted_output']:
        try:
            quotes = json.loads(execution['formatted_output']) if isinstance(execution['formatted_output'], str) else execution['formatted_output']
            if isinstance(quotes, list):
                print(f"Found {len(quotes)} quotes:")
                for i, quote in enumerate(quotes, 1):
                    if isinstance(quote, dict):
                        status = quote.get('status', 'Unknown')
                        value = quote.get('quoteValue', 'Unknown')
                        quote_type = quote.get('quoteType', 'Unknown')
                        product = quote.get('carrierProduct', 'Unknown')
                        print(f"   {i}. 💵 {value} ({quote_type})")
                        print(f"      📊 Status: {status}")
                        print(f"      🏢 Product: {product}")
                        print()
            else:
                print(f"Formatted output is not a list: {type(quotes)}")
                print(str(quotes)[:500] + "..." if len(str(quotes)) > 500 else str(quotes))
        except Exception as e:
            print(f"❌ Error parsing formatted output: {e}")
            print(f"Raw formatted output: {execution['formatted_output'][:500]}...")
    
    print(f"\n📊 RESULTS STRUCTURE:")
    if execution['results']:
        results = execution['results']
        if isinstance(results, dict):
            print(f"Results object with {len(results)} keys:")
            for key, value in results.items():
                if isinstance(value, list):
                    print(f"   - {key}: Array with {len(value)} items")
                    if key == 'quotes' and len(value) > 0:
                        print(f"     First quote structure: {list(value[0].keys()) if isinstance(value[0], dict) else type(value[0])}")
                elif isinstance(value, dict):
                    print(f"   - {key}: Object with {len(value)} keys")
                else:
                    print(f"   - {key}: {type(value).__name__} - {str(value)[:100]}")
        else:
            print(f"Results is {type(results)}: {str(results)[:200]}...")

def find_and_show_popular_executions(cur):
    """Find the most popular parameter combinations and show their results."""
    print("🔍 FINDING POPULAR PARAMETER COMBINATIONS")
    print("=" * 60)
    
    # Get the most frequently executed parameter sets
    cur.execute("""
        SELECT execution_params, COUNT(*) as execution_count,
               ARRAY_AGG(id ORDER BY created_at DESC) as execution_ids,
               MAX(created_at) as latest_execution
        FROM workflow_executions 
        WHERE status = 'completed' 
        AND created_at > NOW() - INTERVAL '30 days'
        AND results IS NOT NULL
        GROUP BY execution_params
        HAVING COUNT(*) >= 3
        ORDER BY execution_count DESC
        LIMIT 5
    """)
    
    patterns = cur.fetchall()
    
    if not patterns:
        print("❌ No popular parameter patterns found")
        return
    
    for i, pattern in enumerate(patterns, 1):
        execution_count = pattern['execution_count']
        execution_ids = pattern['execution_ids']
        latest_id = execution_ids[0]  # Most recent execution
        
        print(f"\n🎯 PATTERN {i}: {execution_count} executions")
        print(f"   Most recent execution: {latest_id}")
        print(f"   All execution IDs: {execution_ids[:10]}...")
        
        # Show details for the most recent execution
        show_execution_details(cur, latest_id)
        
        print(f"\n{'='*60}")

def main():
    print("💰 ACTUAL QUOTE RESULTS ANALYSIS")
    print("=" * 60)
    
    conn = get_db_connection()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # First, show some specific high-value executions
            specific_executions = [4398, 4396, 4395]  # From our previous analysis
            
            print("🎯 SPECIFIC HIGH-VALUE EXECUTIONS:")
            for exec_id in specific_executions:
                show_execution_details(cur, exec_id)
                print(f"\n{'='*60}")
            
            # Then show popular patterns
            find_and_show_popular_executions(cur)
            
    except Exception as e:
        print(f"❌ Error: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main() 