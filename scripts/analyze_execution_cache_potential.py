#!/usr/bin/env python3
"""
Analyze Execution Cache Potential

This script searches through execution history to find quotes among successful executions
by testing different input parameter combinations. This helps understand caching effectiveness.
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import json
import hashlib

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection using environment variables."""
    # Use the same connection string as the working check_recent_executions.py script
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    return conn

def create_parameter_hash(params):
    """Create a deterministic hash for parameter comparison."""
    # Sort keys to ensure consistent hashing
    sorted_params = json.dumps(params, sort_keys=True)
    return hashlib.sha256(sorted_params.encode()).hexdigest()[:16]

def search_by_parameters(cur, test_params, description):
    """Search for executions matching specific parameters."""
    print(f"\n🔍 TESTING: {description}")
    print(f"Parameters: {json.dumps(test_params, indent=2)}")
    
    # Search for exact parameter matches
    cur.execute("""
        SELECT id, workflow_id, execution_params, results, formatted_output,
               created_at, execution_duration_seconds, status
        FROM workflow_executions 
        WHERE status = 'completed'
        AND execution_params = %s
        ORDER BY created_at DESC
        LIMIT 5
    """, (json.dumps(test_params),))
    
    exact_matches = cur.fetchall()
    
    if exact_matches:
        print(f"✅ Found {len(exact_matches)} EXACT matches:")
        for i, exec in enumerate(exact_matches, 1):
            print(f"   {i}. Execution {exec['id']} - {exec['created_at']} ({exec['execution_duration_seconds']}s)")
            
            # Show quotes if available
            if exec['formatted_output']:
                try:
                    quotes = json.loads(exec['formatted_output']) if isinstance(exec['formatted_output'], str) else exec['formatted_output']
                    if isinstance(quotes, list) and len(quotes) > 0:
                        print(f"      💰 {len(quotes)} quotes found:")
                        for j, quote in enumerate(quotes[:3], 1):  # Show first 3 quotes
                            if isinstance(quote, dict):
                                status = quote.get('status', 'Unknown')
                                value = quote.get('quoteValue', 'Unknown')
                                product = quote.get('carrierProduct', 'Unknown')[:50]
                                print(f"         {j}. {status} - {value} - {product}...")
                        if len(quotes) > 3:
                            print(f"         ... and {len(quotes) - 3} more quotes")
                except Exception as e:
                    print(f"      ❌ Error parsing quotes: {e}")
            
            # Show results summary
            if exec['results']:
                results = exec['results']
                if isinstance(results, dict):
                    if 'quotes' in results:
                        quote_count = len(results['quotes']) if isinstance(results['quotes'], list) else 0
                        print(f"      📊 Results: {quote_count} quotes in results object")
                    if 'execution_summary' in results:
                        summary = results['execution_summary']
                        if isinstance(summary, dict) and 'workflow_completed' in summary:
                            print(f"      ✅ Workflow completed: {summary['workflow_completed']}")
    else:
        print("❌ No exact matches found")
        
        # Try partial parameter matching for common fields
        common_fields = ['quote_type', 'quote_value', 'applicant_state', 'applicant_gender']
        partial_conditions = []
        partial_params = []
        
        for field in common_fields:
            if field in test_params:
                partial_conditions.append(f"execution_params ->> %s = %s")
                partial_params.extend([field, str(test_params[field])])
        
        if partial_conditions:
            partial_query = f"""
                SELECT id, workflow_id, execution_params, created_at, execution_duration_seconds
                FROM workflow_executions 
                WHERE status = 'completed'
                AND {' AND '.join(partial_conditions)}
                ORDER BY created_at DESC
                LIMIT 3
            """
            cur.execute(partial_query, partial_params)
            partial_matches = cur.fetchall()
            
            if partial_matches:
                print(f"📍 Found {len(partial_matches)} partial matches (similar parameters):")
                for i, exec in enumerate(partial_matches, 1):
                    print(f"   {i}. Execution {exec['id']} - {exec['created_at']} ({exec['execution_duration_seconds']}s)")
                    print(f"      Parameters: {json.dumps(exec['execution_params'], indent=2)[:200]}...")

def analyze_parameter_patterns(cur):
    """Analyze common parameter patterns for caching opportunities."""
    print("\n📊 PARAMETER PATTERN ANALYSIS:")
    
    # Find most common parameter combinations
    cur.execute("""
        SELECT execution_params, COUNT(*) as execution_count,
               MIN(created_at) as first_seen,
               MAX(created_at) as last_seen,
               AVG(execution_duration_seconds) as avg_duration,
               ARRAY_AGG(id ORDER BY created_at DESC) as execution_ids
        FROM workflow_executions 
        WHERE status = 'completed' 
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY execution_params
        HAVING COUNT(*) > 1
        ORDER BY execution_count DESC, last_seen DESC
        LIMIT 10
    """)
    
    patterns = cur.fetchall()
    
    if patterns:
        print(f"Found {len(patterns)} parameter combinations with multiple executions:")
        total_cache_hits = 0
        total_time_saved = 0
        
        for i, pattern in enumerate(patterns, 1):
            execution_count = pattern['execution_count']
            avg_duration = pattern['avg_duration'] or 0
            cache_hits = execution_count - 1  # First execution is not a cache hit
            time_saved = cache_hits * avg_duration
            
            total_cache_hits += cache_hits
            total_time_saved += time_saved
            
            print(f"\n  {i}. 🎯 {execution_count} executions ({cache_hits} potential cache hits)")
            print(f"     ⏱️  Avg duration: {avg_duration:.1f}s")
            print(f"     💰 Time that could be saved: {time_saved:.1f}s ({time_saved/60:.1f} minutes)")
            print(f"     📅 First: {pattern['first_seen']} | Last: {pattern['last_seen']}")
            print(f"     🔢 Execution IDs: {pattern['execution_ids'][:5]}...")
            
            # Show parameter summary
            params = pattern['execution_params']
            if isinstance(params, dict):
                key_params = {k: v for k, v in params.items() if k in ['quote_type', 'quote_value', 'applicant_state', 'product_types']}
                print(f"     📋 Key params: {json.dumps(key_params)}")
        
        print(f"\n🎉 CACHING IMPACT SUMMARY:")
        print(f"   📈 Total potential cache hits: {total_cache_hits}")
        print(f"   ⏱️  Total time that could be saved: {total_time_saved:.1f}s ({total_time_saved/60:.1f} minutes)")
        print(f"   💡 Average time per cache hit: {total_time_saved/total_cache_hits:.1f}s")

def main():
    print("🔍 EXECUTION CACHE POTENTIAL ANALYSIS")
    print("=" * 60)
    
    conn = get_db_connection()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Test different parameter combinations
            test_cases = [
                {
                    "params": {
                        "quote_type": "Face Value",
                        "quote_value": "5000",
                        "applicant_state": "California",
                        "applicant_gender": "Male"
                    },
                    "description": "Basic California Male $5K Face Value"
                },
                {
                    "params": {
                        "quote_type": "Face Value",
                        "quote_value": "10000",
                        "applicant_state": "Texas",
                        "applicant_gender": "Female"
                    },
                    "description": "Texas Female $10K Face Value"
                },
                {
                    "params": {
                        "product_types": ["FEX"],
                        "applicant_dob": "01/15/1985",
                        "quote_type": "Face Value"
                    },
                    "description": "FEX Product Type with DOB"
                },
                {
                    "params": {
                        "quote_type": "Face Value",
                        "quote_value": "5000",
                        "applicant_dob": "01/15/1985",
                        "product_types": ["FEX"],
                        "applicant_state": "California",
                        "applicant_gender": "Male",
                        "applicant_height": "5 10",
                        "applicant_weight": "180",
                        "registration_key": "4WV-HJR-SA9"
                    },
                    "description": "Complete Parameter Set (from analysis)"
                }
            ]
            
            for test_case in test_cases:
                search_by_parameters(cur, test_case["params"], test_case["description"])
            
            # Analyze overall patterns
            analyze_parameter_patterns(cur)
            
    except Exception as e:
        print(f"❌ Error: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main() 