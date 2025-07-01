#!/usr/bin/env python3
"""
Test the complete production workflow execution flow
This simulates how the Modal function will be called in production
"""

import os
import sys
import json
import asyncio
from datetime import datetime

# Add modal-apps to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'modal-apps'))

def test_production_workflow_execution():
    """Test the full production workflow execution with database integration"""
    
    print("🧪 Testing Production Workflow Execution Flow")
    print("=" * 60)
    
    # Import the workflow executor module
    import workflow_executor
    
    # For local testing, we need to access the actual Python function
    # In production, Modal wraps this, but locally we can call it directly
    if hasattr(workflow_executor.execute_workflow, 'local'):
        # If it's a Modal function, use .local() for local execution
        execute_workflow = workflow_executor.execute_workflow.local
    else:
        # Otherwise use the function directly
        execute_workflow = workflow_executor.execute_workflow
    
    # Production parameters - exactly how API will call it
    workflow_id = 1  # Best Plan Pro Insurance Quote from database
    
    execution_params = {
        "customer_info": {
            "name": "John Doe",
            "age": 35,
            "gender": "Male",
            "date_of_birth": "01/15/1989",
            "phone": "555-123-4567",
            "email": "john.doe@example.com"
        },
        "insurance_preferences": {
            "coverage_amount": 500000,
            "term_length": "20 years",
            "premium_budget": 100
        }
    }
    
    client_id = "test-client-123"
    
    print(f"📋 Test Configuration:")
    print(f"   Workflow ID: {workflow_id}")
    print(f"   Client ID: {client_id}")
    print(f"   Customer: {execution_params['customer_info']['name']}, Age {execution_params['customer_info']['age']}")
    print(f"   Coverage: ${execution_params['insurance_preferences']['coverage_amount']:,}")
    
    # Set up environment variables (these would be set by Modal in production)
    if not os.getenv("NEXT_PUBLIC_SUPABASE_URL"):
        print("\n⚠️  Warning: Supabase environment variables not set!")
        print("   This test requires database access.")
        print("   Please set:")
        print("   - NEXT_PUBLIC_SUPABASE_URL")
        print("   - SUPABASE_SERVICE_KEY")
        return False
    
    try:
        print("\n🚀 Calling execute_workflow (simulating Modal function call)...")
        print("   This will:")
        print("   1. Load workflow from database")
        print("   2. Create execution record")
        print("   3. Connect to MCP for browser automation")
        print("   4. Execute all workflow steps")
        print("   5. Parse results and save to database")
        
        # Call the function exactly as Modal would
        result = execute_workflow(
            workflow_id=workflow_id,
            execution_params=execution_params,
            client_id=client_id
        )
        
        # Display results
        print("\n✅ Execution completed!")
        print(f"\n📊 Results:")
        print(f"   Success: {result.get('success')}")
        print(f"   Execution ID: {result.get('execution_id')}")
        print(f"   Status: {result.get('status')}")
        print(f"   Duration: {result.get('execution_duration_seconds')}s")
        print(f"   Execution Type: {result.get('execution_type')}")
        print(f"   Quotes Found: {result.get('quotes_found', 0)}")
        
        if result.get('success') and result.get('results'):
            results = result['results']
            
            # Display applicant info
            if results.get('applicant_info'):
                print("\n👤 Applicant Info Extracted:")
                for key, value in results['applicant_info'].items():
                    if value:
                        print(f"   {key}: {value}")
            
            # Display quotes
            if results.get('quotes'):
                print(f"\n💰 Insurance Quotes ({len(results['quotes'])} found):")
                for i, quote in enumerate(results['quotes'], 1):
                    print(f"\n   Quote {i}:")
                    print(f"   Carrier: {quote.get('carrier')}")
                    print(f"   Product: {quote.get('product')}")
                    print(f"   Monthly Price: {quote.get('monthly_price')}")
                    print(f"   Eligible: {'✅ Yes' if quote.get('eligible') else '❌ No'}")
                    if quote.get('status') and quote['status'] != ['Available']:
                        print(f"   Status: {', '.join(quote['status'])}")
            
            # Display execution summary
            if results.get('execution_summary'):
                summary = results['execution_summary']
                print(f"\n📈 Execution Summary:")
                print(f"   Workflow Completed: {'✅ Yes' if summary.get('workflow_completed') else '❌ No'}")
                print(f"   Success Rate: {summary.get('success_rate_percentage')}%")
                print(f"   Message: {summary.get('execution_message')}")
        
        elif not result.get('success'):
            print(f"\n❌ Execution failed!")
            print(f"   Error: {result.get('error')}")
        
        # Show database record location
        if result.get('execution_id'):
            print(f"\n💾 Results saved to database:")
            print(f"   Table: workflow_executions")
            print(f"   ID: {result['execution_id']}")
            print(f"   Query: SELECT * FROM workflow_executions WHERE id = {result['execution_id']};")
        
        return result.get('success', False)
        
    except Exception as e:
        print(f"\n❌ Error during execution: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_modal_deployment_simulation():
    """Simulate how Modal will call the function in production"""
    print("\n\n🎭 Simulating Modal Deployment Call")
    print("=" * 60)
    
    print("In production, the flow will be:")
    print("1. Vercel API receives POST request")
    print("2. Vercel imports and calls Modal function:")
    print("\n```python")
    print("from modal import Function")
    print("")
    print("# Get deployed Modal function")
    print('execute_fn = Function.lookup("workflow-executor", "execute_workflow")')
    print("")
    print("# Call it with production parameters")
    print("result = execute_fn.remote(")
    print("    workflow_id=1,")
    print("    execution_params={...customer data...},")
    print("    client_id='api-client-123'")
    print(")")
    print("```")
    print("\n3. Modal function executes on Modal infrastructure")
    print("4. Results returned to Vercel API")
    print("5. API returns response to client")


if __name__ == "__main__":
    # Show MCP endpoint configuration
    mcp_endpoint = "https://select-merely-gelding.ngrok-free.app/mcp"
    print(f"🔗 MCP Endpoint: {mcp_endpoint}")
    print(f"📊 Database: Using production Supabase")
    print(f"🎯 Workflow: ID 1 (Best Plan Pro Insurance Quote)")
    
    # Test production flow
    success = test_production_workflow_execution()
    
    # Show Modal deployment simulation
    test_modal_deployment_simulation()
    
    if success:
        print("\n\n✅ Production test successful! Ready for Modal deployment.")
        print("\n📝 Next steps:")
        print("1. Deploy to Modal: modal deploy modal-apps/workflow_executor.py")
        print("2. Test via API: POST /api/remote-workflows/1/execute")
        print("3. Monitor results in workflow_executions table")
    else:
        print("\n\n❌ Production test failed. Please fix issues before deploying.")
        print("\n🔍 Common issues:")
        print("- Missing environment variables")
        print("- Database connection issues")
        print("- MCP endpoint not accessible")
        print("- Workflow not found in database") 