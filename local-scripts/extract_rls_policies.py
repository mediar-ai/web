#!/usr/bin/env python3
"""
Script to extract RLS policies from Supabase production database
"""

import psycopg2
import json

def extract_rls_policies():
    # Connect to production database (pooler connection string)
    conn = psycopg2.connect(
        "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
    )
    cursor = conn.cursor()

    print("=" * 80)
    print("TABLES WITH RLS ENABLED")
    print("=" * 80)

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

    cursor.execute(rls_status_query)
    tables_with_rls = cursor.fetchall()

    for row in tables_with_rls:
        print(f"\n{row[1]} (RLS enabled)")

    print("\n" + "=" * 80)
    print("RLS POLICIES")
    print("=" * 80)

    # Query to get all RLS policies with their definitions
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

    cursor.execute(rls_query)
    policies = cursor.fetchall()

    current_table = None
    for policy in policies:
        schema, table, name, permissive, roles, cmd, qual, with_check = policy

        if table != current_table:
            print(f"\n\n{'-' * 80}")
            print(f"TABLE: {table}")
            print(f"{'-' * 80}")
            current_table = table

        print(f"\nPolicy: {name}")
        print(f"  Type: {'PERMISSIVE' if permissive == 'PERMISSIVE' else 'RESTRICTIVE'}")
        print(f"  Roles: {', '.join(roles) if roles else 'N/A'}")
        print(f"  Command: {cmd}")
        if qual:
            print(f"  USING: {qual}")
        if with_check:
            print(f"  WITH CHECK: {with_check}")

    print("\n" + "=" * 80)
    print(f"Total tables with RLS: {len(tables_with_rls)}")
    print(f"Total policies: {len(policies)}")
    print("=" * 80)

    cursor.close()
    conn.close()

if __name__ == "__main__":
    extract_rls_policies()