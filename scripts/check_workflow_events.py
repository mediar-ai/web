#!/usr/bin/env python3

import psycopg2
import json
import sys
from datetime import datetime

# Database connection
try:
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    print(f"Checking ALL workflow annotations for user: {user_id}")
    print("=" * 80)
    
    # Check workflow event entries in low_level_datasets
    cursor.execute("""
        SELECT COUNT(*) FROM low_level_datasets 
        WHERE user_id = %s AND dataset_type = 'workflow_event_feedback'
    """, (user_id,))
    workflow_event_count = cursor.fetchone()[0]
    print(f"Found {workflow_event_count} workflow event entries in low_level_datasets")
    
    # Count total workflow analyses
    cursor.execute("""
        SELECT COUNT(*) FROM low_level_workflow_analyses 
        WHERE user_id = %s
    """, (user_id,))
    total_analyses = cursor.fetchone()[0]
    print(f"Total workflow analyses for this user: {total_analyses}")
    
    # Check raw_timeline_event_annotations (LIKELY WHERE 188 ANNOTATIONS ARE!)
    print("\n1. Checking raw_timeline_event_annotations...")
    cursor.execute("""
        SELECT COUNT(*) FROM raw_timeline_event_annotations 
        WHERE user_id = %s
    """, (user_id,))
    raw_annotations_count = cursor.fetchone()[0]
    print(f"Found {raw_annotations_count} raw timeline event annotations for this user")
    
    if raw_annotations_count > 0:
        # Check schema
        cursor.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'raw_timeline_event_annotations' AND table_schema = 'public'
            ORDER BY ordinal_position
        """)
        raw_columns = cursor.fetchall()
        print("Columns in raw_timeline_event_annotations:")
        for col_name, data_type in raw_columns:
            print(f"  {col_name}: {data_type}")
        
        # Get sample data
        cursor.execute("""
            SELECT id, workflow_step, workflow_substep, workflow_instance, created_at
            FROM raw_timeline_event_annotations 
            WHERE user_id = %s
            ORDER BY created_at DESC 
            LIMIT 5
        """, (user_id,))
        
        samples = cursor.fetchall()
        print(f"\nFirst 5 raw timeline annotations:")
        for row in samples:
            annotation_id, step, substep, instance, created_at = row
            print(f"  ID: {annotation_id}, Step: {step}, Substep: {substep}")
            print(f"  Instance: {instance}, Created: {created_at}")
            print("-" * 60)
    
    # Check timeline_event_annotations
    print("\n2. Checking timeline_event_annotations...")
    cursor.execute("""
        SELECT COUNT(*) FROM timeline_event_annotations 
        WHERE user_id = %s
    """, (user_id,))
    timeline_annotations_count = cursor.fetchone()[0]
    print(f"Found {timeline_annotations_count} timeline event annotations for this user")
    
    if timeline_annotations_count > 0:
        # Check schema
        cursor.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'timeline_event_annotations' AND table_schema = 'public'
            ORDER BY ordinal_position
        """)
        timeline_columns = cursor.fetchall()
        print("Columns in timeline_event_annotations:")
        for col_name, data_type in timeline_columns:
            print(f"  {col_name}: {data_type}")
        
        # Get sample data
        cursor.execute("""
            SELECT id, workflow_step_id, workflow_substep_id, workflow_instance_name, created_at
            FROM timeline_event_annotations 
            WHERE user_id = %s
            ORDER BY created_at DESC 
            LIMIT 5
        """, (user_id,))
        
        samples = cursor.fetchall()
        print(f"\nFirst 5 timeline event annotations:")
        for row in samples:
            annotation_id, step_id, substep_id, instance_name, created_at = row
            print(f"  ID: {annotation_id}, Step ID: {step_id}, Substep ID: {substep_id}")
            print(f"  Instance: {instance_name}, Created: {created_at}")
            print("-" * 60)
    
    # Check timeline_annotations_with_analysis
    print("\n3. Checking timeline_annotations_with_analysis...")
    cursor.execute("""
        SELECT COUNT(*) FROM timeline_annotations_with_analysis 
        WHERE user_id = %s
    """, (user_id,))
    analysis_annotations_count = cursor.fetchone()[0]
    print(f"Found {analysis_annotations_count} timeline annotations with analysis for this user")
    
    if analysis_annotations_count > 0:
        # Get sample data
        cursor.execute("""
            SELECT workflow_id, workflow_step_id, workflow_substep_id, workflow_instance_name, created_at
            FROM timeline_annotations_with_analysis 
            WHERE user_id = %s
            ORDER BY created_at DESC 
            LIMIT 5
        """, (user_id,))
        
        samples = cursor.fetchall()
        print(f"\nFirst 5 timeline annotations with analysis:")
        for row in samples:
            workflow_id, step_id, substep_id, instance_name, created_at = row
            print(f"  Workflow ID: {workflow_id}, Step ID: {step_id}, Substep ID: {substep_id}")
            print(f"  Instance: {instance_name}, Created: {created_at}")
            print("-" * 60)
    
    print(f"\n=== SUMMARY ===")
    print(f"Low level datasets (workflow_event_feedback): {workflow_event_count}")
    print(f"Low level workflow analyses: {total_analyses}")
    print(f"Raw timeline event annotations: {raw_annotations_count}")
    print(f"Timeline event annotations: {timeline_annotations_count}")
    print(f"Timeline annotations with analysis: {analysis_annotations_count}")
    print(f"TOTAL ANNOTATIONS: {raw_annotations_count + timeline_annotations_count + analysis_annotations_count}")

except Exception as e:
    print(f"Error: {e}")
finally:
    if conn:
        conn.close() 