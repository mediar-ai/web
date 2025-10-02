#!/usr/bin/env python3
"""
Analyze performance issues with loading execution details in the UI.
This script checks the size and complexity of execution data in production.
"""

import os
import json
import requests
import time
from datetime import datetime, timedelta
import statistics

# Get Supabase credentials - using production URL
SUPABASE_URL = "https://eshwntsgsputksqamckh.supabase.co"
# This needs to be set as environment variable for security
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "***REMOVED***")

def get_recent_executions(limit=20):
    """Get recent workflow executions"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    # Get recent executions
    url = f"{SUPABASE_URL}/rest/v1/workflow_executions"
    params = {
        "select": "id, workflow_id, status, created_at, execution_duration_seconds",
        "order": "created_at.desc",
        "limit": limit
    }

    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching executions: {e}")
        return []

def measure_execution_fetch_time(execution_id, full_detailed=True):
    """Measure how long it takes to fetch execution details"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    # Simulate what the API does
    if full_detailed:
        select_fields = "*, raw_logs, raw_mcp_response, execution_logs, results, formatted_output"
    else:
        select_fields = "id, workflow_id, status, started_at, completed_at, execution_duration_seconds, error_message, modal_call_id, execution_params, created_at, updated_at, progress_percentage, current_step_index, total_steps, formatted_output, version_number, workflow_version_id, client_id, assigned_machine_id"

    url = f"{SUPABASE_URL}/rest/v1/workflow_executions"
    params = {
        "select": select_fields,
        "id": f"eq.{execution_id}"
    }

    start_time = time.time()
    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        fetch_time = time.time() - start_time

        if data:
            execution = data[0]
            # Calculate sizes
            data_size = len(json.dumps(execution))

            # Count heavy fields
            heavy_fields = {
                'raw_logs': len(json.dumps(execution.get('raw_logs', ''))) if execution.get('raw_logs') else 0,
                'raw_mcp_response': len(json.dumps(execution.get('raw_mcp_response', ''))) if execution.get('raw_mcp_response') else 0,
                'execution_logs': len(json.dumps(execution.get('execution_logs', []))) if execution.get('execution_logs') else 0,
                'results': len(json.dumps(execution.get('results', {}))) if execution.get('results') else 0,
                'formatted_output': len(json.dumps(execution.get('formatted_output', ''))) if execution.get('formatted_output') else 0,
            }

            return {
                'fetch_time': fetch_time,
                'total_size': data_size,
                'heavy_fields': heavy_fields,
                'execution_id': execution_id,
                'status': execution.get('status'),
                'has_logs': bool(execution.get('execution_logs')),
                'log_count': len(execution.get('execution_logs', [])) if execution.get('execution_logs') else 0
            }
        return None
    except Exception as e:
        print(f"Error fetching execution {execution_id}: {e}")
        return None

def format_bytes(bytes):
    """Format bytes to human readable string"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes < 1024.0:
            return f"{bytes:.2f} {unit}"
        bytes /= 1024.0
    return f"{bytes:.2f} TB"

def main():
    print("\n" + "="*80)
    print("EXECUTION DETAILS PERFORMANCE ANALYSIS")
    print("="*80)

    # Get recent executions
    print("\nFetching recent executions...")
    recent_executions = get_recent_executions(50)

    if not recent_executions:
        print("No executions found")
        return

    print(f"Found {len(recent_executions)} recent executions")

    # Test performance for each execution
    print("\nAnalyzing fetch performance for recent executions...")
    print("-" * 80)

    results_full = []
    results_basic = []
    problematic = []

    for i, execution in enumerate(recent_executions[:20], 1):  # Test first 20
        exec_id = execution['id']
        print(f"\n[{i}/20] Testing execution #{exec_id} ({execution['status']})...")

        # Test full detailed response
        result_full = measure_execution_fetch_time(exec_id, full_detailed=True)
        if result_full:
            results_full.append(result_full)
            print(f"  Full fetch: {result_full['fetch_time']:.2f}s, Size: {format_bytes(result_full['total_size'])}")

            # Check if problematic (>2 seconds or >5MB)
            if result_full['fetch_time'] > 2.0 or result_full['total_size'] > 5*1024*1024:
                problematic.append(result_full)
                print(f"  WARNING - SLOW/LARGE: {result_full['fetch_time']:.2f}s / {format_bytes(result_full['total_size'])}")

                # Show breakdown
                print(f"  Field sizes:")
                for field, size in result_full['heavy_fields'].items():
                    if size > 0:
                        print(f"    - {field}: {format_bytes(size)}")

        # Test basic response
        result_basic = measure_execution_fetch_time(exec_id, full_detailed=False)
        if result_basic:
            results_basic.append(result_basic)
            print(f"  Basic fetch: {result_basic['fetch_time']:.2f}s, Size: {format_bytes(result_basic['total_size'])}")

        time.sleep(0.1)  # Be nice to the API

    # Summary statistics
    print("\n" + "="*80)
    print("PERFORMANCE SUMMARY")
    print("="*80)

    if results_full:
        fetch_times_full = [r['fetch_time'] for r in results_full]
        sizes_full = [r['total_size'] for r in results_full]

        print("\nFull Detailed Response Stats:")
        print(f"  Fetch Time - Avg: {statistics.mean(fetch_times_full):.2f}s, Max: {max(fetch_times_full):.2f}s, Min: {min(fetch_times_full):.2f}s")
        print(f"  Data Size - Avg: {format_bytes(statistics.mean(sizes_full))}, Max: {format_bytes(max(sizes_full))}, Min: {format_bytes(min(sizes_full))}")

    if results_basic:
        fetch_times_basic = [r['fetch_time'] for r in results_basic]
        sizes_basic = [r['total_size'] for r in results_basic]

        print("\nBasic Response Stats:")
        print(f"  Fetch Time - Avg: {statistics.mean(fetch_times_basic):.2f}s, Max: {max(fetch_times_basic):.2f}s, Min: {min(fetch_times_basic):.2f}s")
        print(f"  Data Size - Avg: {format_bytes(statistics.mean(sizes_basic))}, Max: {format_bytes(max(sizes_basic))}, Min: {format_bytes(min(sizes_basic))}")

    if problematic:
        print("\n" + "="*80)
        print(f"PROBLEMATIC EXECUTIONS ({len(problematic)} found)")
        print("="*80)

        for p in sorted(problematic, key=lambda x: x['fetch_time'], reverse=True)[:5]:
            print(f"\nExecution #{p['execution_id']}:")
            print(f"  Status: {p['status']}")
            print(f"  Fetch time: {p['fetch_time']:.2f}s")
            print(f"  Total size: {format_bytes(p['total_size'])}")
            print(f"  Log count: {p['log_count']}")
            print(f"  Heavy fields:")
            for field, size in sorted(p['heavy_fields'].items(), key=lambda x: x[1], reverse=True):
                if size > 10000:  # Only show fields >10KB
                    print(f"    - {field}: {format_bytes(size)}")

    # Recommendations
    print("\n" + "="*80)
    print("PERFORMANCE BOTTLENECK ANALYSIS")
    print("="*80)

    # Identify main bottlenecks
    if problematic:
        # Check which fields are causing issues
        total_logs_size = sum(p['heavy_fields'].get('execution_logs', 0) for p in problematic)
        total_raw_logs_size = sum(p['heavy_fields'].get('raw_logs', 0) for p in problematic)
        total_mcp_size = sum(p['heavy_fields'].get('raw_mcp_response', 0) for p in problematic)
        total_results_size = sum(p['heavy_fields'].get('results', 0) for p in problematic)

        print("\nMain bottlenecks identified:")

        bottlenecks = [
            ('execution_logs', total_logs_size, "Execution logs are very large"),
            ('raw_logs', total_raw_logs_size, "Raw logs field contains huge amounts of data"),
            ('raw_mcp_response', total_mcp_size, "MCP response data is very large"),
            ('results', total_results_size, "Results field contains large data")
        ]

        for field, size, description in sorted(bottlenecks, key=lambda x: x[1], reverse=True):
            if size > 0:
                avg_size = size / len(problematic)
                print(f"\n  * {field}:")
                print(f"    - Total size across problematic executions: {format_bytes(size)}")
                print(f"    - Average size: {format_bytes(avg_size)}")
                print(f"    - Issue: {description}")

        # Check for specific patterns
        large_log_counts = [p for p in problematic if p['log_count'] > 1000]
        if large_log_counts:
            print(f"\n  * Excessive log entries:")
            print(f"    - {len(large_log_counts)} executions have >1000 log entries")
            print(f"    - Max log count: {max(p['log_count'] for p in large_log_counts)}")

    print("\n" + "="*80)
    print("RECOMMENDATIONS")
    print("="*80)

    print("\n1. IMMEDIATE OPTIMIZATIONS:")
    print("   * The API is already using conditional field selection (full_detailed_response)")
    print("   * However, the UI always requests full_detailed_response=true")
    print("   * Change the UI to only request heavy fields when needed (lazy loading)")

    print("\n2. LAZY LOADING STRATEGY:")
    print("   * Load basic execution info first (status, times, params)")
    print("   * Load execution_logs only when 'Logs' tab is clicked")
    print("   * Load results/formatted_output only when 'Summary' tab needs it")

    print("\n3. DATA OPTIMIZATION:")
    print("   * Consider pagination for execution_logs (load first 100, then more on scroll)")
    print("   * Compress or truncate raw_logs and raw_mcp_response fields")
    print("   * Store large data in separate tables with on-demand fetching")

    print("\n4. UI IMPROVEMENTS:")
    print("   * Add loading skeleton for each tab independently")
    print("   * Show partial data while loading rest")
    print("   * Cache execution details client-side to avoid re-fetching")

if __name__ == "__main__":
    main()