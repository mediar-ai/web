#!/usr/bin/env python3
"""
Investigate execution #10432 to understand why parser output was missing
"""

import os
import json
import requests
from datetime import datetime

# Get Supabase credentials
SUPABASE_URL = "https://lqnlxsvefdzljnugpmii.supabase.co"
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxxbmx4c3ZlZmR6bGpudWdwbWlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyODA0NDI2MCwiZXhwIjoyMDQzNjIwMjYwfQ.g4a_V1f8-mjCtd5OWMKWjdPXRBYQlGxCdMdGz6hBOy8")

def get_execution_details(execution_id):
    """Get full details for a specific execution"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    # Query for the execution with all relevant fields
    url = f"{SUPABASE_URL}/rest/v1/workflow_executions"
    params = {
        "select": "*, deployed_workflows(name, automation_sequence_yaml)",
        "id": f"eq.{execution_id}"
    }

    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        executions = response.json()

        if executions:
            return executions[0]
        return None

    except Exception as e:
        print(f"Error fetching execution: {e}")
        return None

def analyze_execution(execution):
    """Analyze the execution to understand parser output"""
    print(f"\n{'='*80}")
    print(f"EXECUTION #{execution['id']} ANALYSIS")
    print(f"{'='*80}\n")

    # Basic info
    print("BASIC INFO:")
    print(f"  Workflow ID: {execution['workflow_id']}")
    if 'deployed_workflows' in execution:
        print(f"  Workflow Name: {execution['deployed_workflows'].get('name', 'Unknown')}")
    print(f"  Status: {execution['status']}")
    print(f"  Created: {execution['created_at']}")
    print(f"  Started: {execution['started_at']}")
    print(f"  Completed: {execution['completed_at']}")
    print(f"  Duration: {execution.get('execution_duration_seconds', 'N/A')} seconds")
    print(f"  Client ID: {execution.get('client_id', 'N/A')}")

    # Check formatted output
    print(f"\nFORMATTED OUTPUT:")
    formatted_output = execution.get('formatted_output')
    if formatted_output:
        try:
            formatted_data = json.loads(formatted_output) if isinstance(formatted_output, str) else formatted_output
            print(f"  Status: {formatted_data.get('status', 'N/A')}")
            print(f"  Success: {formatted_data.get('success', 'N/A')}")
            print(f"  Message: {formatted_data.get('message', 'N/A')}")

            # Check for data field
            if 'data' in formatted_data:
                print(f"  Data fields: {list(formatted_data['data'].keys()) if isinstance(formatted_data['data'], dict) else 'Not a dict'}")

                # Check for SAP-specific fields
                if isinstance(formatted_data['data'], dict):
                    if 'error_summary' in formatted_data['data']:
                        print(f"  ERROR SUMMARY FOUND:")
                        error_summary = formatted_data['data']['error_summary']
                        print(f"    Error Type: {error_summary.get('error_type', 'N/A')}")
                        print(f"    Error Reason: {error_summary.get('error_reason', 'N/A')}")

                    if 'failure_details' in formatted_data['data']:
                        print(f"  FAILURE DETAILS FOUND:")
                        failure_details = formatted_data['data']['failure_details']
                        if 'financial_state' in failure_details:
                            fs = failure_details['financial_state']
                            print(f"    Debit Total: {fs.get('debit_total', 'N/A')}")
                            print(f"    Credit Total: {fs.get('credit_total', 'N/A')}")
                            print(f"    Difference: {fs.get('difference', 'N/A')}")

        except json.JSONDecodeError as e:
            print(f"  Error parsing JSON: {e}")
        except Exception as e:
            print(f"  Error analyzing: {e}")
    else:
        print("  No formatted_output found!")

    # Check error message
    if execution.get('error_message'):
        print(f"\nERROR MESSAGE:")
        print(f"  {execution['error_message']}")

    # Check results field
    print(f"\nRESULTS FIELD:")
    results = execution.get('results')
    if results:
        if isinstance(results, dict):
            print(f"  Has 'output' key: {'output' in results}")
            print(f"  Has 'execution' key: {'execution' in results}")
            print(f"  Has 'performance_metrics' key: {'performance_metrics' in results}")

            if 'output' in results:
                output = results['output']
                print(f"  Output status: {output.get('status', 'N/A')}")
                print(f"  Output success: {output.get('success', 'N/A')}")
                print(f"  Output message: {output.get('message', 'N/A')}")

                if 'data' in output and output['data']:
                    print(f"  Output data fields: {list(output['data'].keys()) if isinstance(output['data'], dict) else 'Not a dict'}")
        else:
            print(f"  Results is not a dict: {type(results)}")
    else:
        print("  No results field found!")

    # Check if workflow has output_parser
    print(f"\nWORKFLOW CONFIGURATION:")
    if 'deployed_workflows' in execution:
        yaml_seq = execution['deployed_workflows'].get('automation_sequence_yaml')
        if yaml_seq and 'output_parser' in yaml_seq:
            print("  Workflow HAS output_parser configured")
            # Try to find the parser step
            if 'items:' in yaml_seq:
                lines = yaml_seq.split('\n')
                for i, line in enumerate(lines):
                    if 'output_parser' in line.lower():
                        print(f"  Parser found at line {i+1}")
                        # Print surrounding lines for context
                        start = max(0, i-2)
                        end = min(len(lines), i+3)
                        print("  Parser configuration:")
                        for j in range(start, end):
                            print(f"    {lines[j]}")
        else:
            print("  Workflow does NOT have output_parser configured")

    # Check raw_mcp_response size
    if execution.get('raw_mcp_response'):
        print(f"\nRAW MCP RESPONSE:")
        mcp_response = execution['raw_mcp_response']
        if isinstance(mcp_response, str):
            print(f"  Size: {len(mcp_response)} characters")
        elif isinstance(mcp_response, dict):
            print(f"  Type: dict with keys: {list(mcp_response.keys())[:5]}...")
            if 'parsed_output' in mcp_response:
                print(f"  Has parsed_output key!")
                parsed = mcp_response['parsed_output']
                print(f"  Parsed output type: {type(parsed)}")
                if isinstance(parsed, dict):
                    print(f"  Parsed output keys: {list(parsed.keys())}")
    else:
        print(f"\nRAW MCP RESPONSE: Not available")

def main():
    print("[INVESTIGATE] Investigating Execution #10432")
    print("Purpose: Understand why parser output was missing/not displayed correctly")

    # Fetch execution details
    execution = get_execution_details(10432)

    if execution:
        analyze_execution(execution)

        # Save raw data for further analysis
        with open('execution_10432_raw.json', 'w') as f:
            json.dump(execution, f, indent=2, default=str)
        print(f"\n[SAVED] Raw data saved to: execution_10432_raw.json")
    else:
        print("[ERROR] Could not fetch execution #10432")

if __name__ == "__main__":
    main()