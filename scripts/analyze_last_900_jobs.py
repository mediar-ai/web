#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime
from collections import Counter

def analyze_last_900_jobs():
    """Analyze the last 900 workflow executions to identify failure patterns"""
    try:
        # Connect to database
        conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
        cur = conn.cursor()
        
        print("🔍 ANALYZING LAST 900 WORKFLOW EXECUTIONS")
        print("=" * 80)
        
        # Get last 900 executions
        cur.execute("""
        SELECT 
            id,
            status,
            created_at,
            started_at,
            completed_at,
            EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, created_at))) / 60 as duration_minutes,
            execution_params->'product_types' as product_types,
            error_message,
            modal_call_id
        FROM workflow_executions 
        ORDER BY id DESC
        LIMIT 900;
        """)
        
        results = cur.fetchall()
        total_jobs = len(results)
        print(f"📊 Total jobs analyzed: {total_jobs}")
        print()
        
        # Analyze by status
        status_counts = Counter()
        failed_jobs = []
        successful_jobs = []
        running_jobs = []
        
        # Track when failures started
        consecutive_failures = 0
        failure_start_id = None
        last_success_id = None
        
        # Process jobs in reverse order (oldest to newest)
        for i, job in enumerate(reversed(results)):
            id_, status, created, started, completed, duration, product_types, error, modal_call_id = job
            status_counts[status] += 1
            
            if status == 'failed':
                failed_jobs.append((id_, created, error))
                consecutive_failures += 1
                if failure_start_id is None:
                    failure_start_id = id_
            elif status == 'completed':
                successful_jobs.append((id_, created, duration))
                if consecutive_failures > 0 and last_success_id is None:
                    last_success_id = id_
                consecutive_failures = 0
                failure_start_id = None
            elif status in ['running', 'queued']:
                running_jobs.append((id_, created, duration))
        
        # Print status distribution
        print("📈 STATUS DISTRIBUTION:")
        for status, count in sorted(status_counts.items(), key=lambda x: x[1], reverse=True):
            percentage = (count / total_jobs) * 100
            print(f"  {status:>12}: {count:>4} ({percentage:>5.1f}%)")
        
        print()
        
        # Analyze failure pattern
        print("🔍 FAILURE PATTERN ANALYSIS:")
        if failed_jobs:
            recent_failures = [job for job in failed_jobs if job[0] >= max(0, max(r[0] for r in results) - 100)]
            print(f"  Recent failures (last 100 jobs): {len(recent_failures)}")
            
            # Find when current failure streak started
            failure_streak = 0
            streak_start_id = None
            for job in results:  # Already in newest-first order
                if job[1] == 'failed':
                    failure_streak += 1
                    streak_start_id = job[0]
                else:
                    break
                    
            if failure_streak > 0:
                print(f"  🔥 Current failure streak: {failure_streak} jobs")
                print(f"  📍 Streak started at execution ID: {streak_start_id}")
                
                # Find last successful job before streak
                for job in results:
                    if job[0] < streak_start_id and job[1] == 'completed':
                        print(f"  ✅ Last successful job: ID {job[0]} at {job[2]}")
                        break
        
        print()
        
        # Analyze error patterns
        print("❌ ERROR ANALYSIS:")
        error_patterns = Counter()
        for id_, created, error in failed_jobs[-50:]:  # Last 50 failures
            if error:
                # Extract the main error type
                if "MCP Execution Failed" in error:
                    error_patterns["MCP Execution Failed"] += 1
                elif "timeout" in error.lower():
                    error_patterns["Timeout"] += 1
                elif "connection" in error.lower():
                    error_patterns["Connection Error"] += 1
                else:
                    error_patterns["Other"] += 1
            else:
                error_patterns["No Error Message"] += 1
        
        for error_type, count in error_patterns.most_common():
            print(f"  {error_type}: {count}")
        
        print()
        
        # Check for stuck running jobs
        print("🔄 RUNNING JOBS ANALYSIS:")
        if running_jobs:
            for id_, created, duration in running_jobs:
                if duration and duration > 30:  # Running for more than 30 minutes
                    print(f"  ⚠️  STUCK: ID {id_} running for {duration:.1f} minutes (created: {created})")
                else:
                    print(f"  🔄 Running: ID {id_} for {duration:.1f if duration else 0} minutes")
        else:
            print("  No currently running jobs")
        
        print()
        
        # Success rate analysis by time periods
        print("📊 SUCCESS RATE BY PERIODS:")
        periods = [
            ("Last 50 jobs", results[:50]),
            ("Last 100 jobs", results[:100]),
            ("Last 500 jobs", results[:500]),
            ("All 900 jobs", results)
        ]
        
        for period_name, period_data in periods:
            total = len(period_data)
            completed = sum(1 for job in period_data if job[1] == 'completed')
            failed = sum(1 for job in period_data if job[1] == 'failed')
            success_rate = (completed / total * 100) if total > 0 else 0
            print(f"  {period_name:>15}: {completed:>3}/{total:>3} = {success_rate:>5.1f}% success")
        
        print()
        
        # Timeline analysis
        print("⏰ TIMELINE ANALYSIS:")
        if results:
            oldest_job = results[-1]
            newest_job = results[0]
            print(f"  📅 Oldest job: ID {oldest_job[0]} at {oldest_job[2]}")
            print(f"  📅 Newest job: ID {newest_job[0]} at {newest_job[2]}")
            
            # Calculate time span
            if oldest_job[2] and newest_job[2]:
                time_span = newest_job[2] - oldest_job[2]
                print(f"  ⏱️  Time span: {time_span}")
                print(f"  📈 Job rate: {total_jobs / (time_span.total_seconds() / 3600):.1f} jobs/hour")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    analyze_last_900_jobs() 