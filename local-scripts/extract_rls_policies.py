#!/usr/bin/env python3
"""
Script to extract RLS policies from Supabase production database
"""

import psycopg2
import os
from urllib.parse import urlparse

def extract_rls_policies():
    # Get database URL from environment
    supabase_url = "https://eshwntsgsputksqamckh.supabase.co"
    service_key = "***REMOVED***"
    
    # Construct the connection string for Supabase
    # Supabase database URL format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
    project_ref = "eshwntsgsputksqamckh"
    
    # We need the database password. For Supabase, we'll try to use the service key as password
    # or we need to get the actual database password
    
    print("Note: To extract RLS policies, we need the database password.")
    print("The service role key won't work for direct PostgreSQL connection.")
    print("Please provide your Supabase database password or use Supabase CLI with Docker.")
    
    # Query to get all RLS policies
    rls_query = """
    SELECT 
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
    FROM pg_policies 
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
    """
    
    # Query to get table-level RLS status
    rls_status_query = """
    SELECT 
        schemaname,
        tablename,
        rowsecurity
    FROM pg_tables 
    WHERE schemaname = 'public' AND rowsecurity = true
    ORDER BY tablename;
    """
    
    print("SQL queries to run manually in Supabase SQL editor:")
    print("\n-- Get RLS policies:")
    print(rls_query)
    print("\n-- Get tables with RLS enabled:")
    print(rls_status_query)

if __name__ == "__main__":
    extract_rls_policies()