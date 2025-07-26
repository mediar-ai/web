# modal_apps/full_synthesis_orchestrator.py
import modal
import os
import psycopg2
import json
import requests
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = modal.App("full-synthesis-orchestrator")

# Install required packages - removed Google Cloud SDK
app.image = modal.Image.debian_slim().pip_install([
    "psycopg2-binary", 
    "requests"
])

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': 'dS64xX6mU3E4Sbyc'
}

# Production API base URL
API_BASE_URL = "http://localhost:3000/api"

def get_database_connection():
    """Gets a new database connection with comprehensive logging."""
    logger.info("🔌 Establishing database connection...")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        logger.info("✅ Database connection established successfully")
        return conn
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        raise

def update_progress(session_id: str, status: str, progress: int, data: Optional[Dict] = None):
    """Update synthesis session progress with detailed logging."""
    conn = get_database_connection()
    try:
        cur = conn.cursor()
        logger.info(f"📊 Updating progress: {status} ({progress}%)")
        
        # Convert session_id to integer if it's a string
        try:
            session_id_int = int(session_id)
        except (ValueError, TypeError):
            logger.error(f"❌ Invalid session_id format: {session_id} (type: {type(session_id)})")
            raise ValueError(f"Session ID must be convertible to integer, got: {session_id}")
        
        query = """
            UPDATE synthesis_sessions 
            SET orchestration_status = %s, 
                orchestration_progress = %s,
                orchestration_data = %s,
                updated_at = NOW()
            WHERE id = %s
        """
        cur.execute(query, (status, progress, json.dumps(data) if data else None, session_id_int))
        conn.commit()
        logger.info(f"✅ Progress updated successfully: {status} ({progress}%) for session {session_id_int}")
        
        if data:
            logger.info(f"📋 Progress data keys: {list(data.keys()) if data else 'None'}")
            
    except Exception as e:
        logger.error(f"❌ Failed to update progress: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

def call_production_endpoint(endpoint: str, payload: Dict) -> Dict:
    """Call production API endpoint with comprehensive logging."""
    url = f"{API_BASE_URL}{endpoint}"
    logger.info(f"🌐 Calling production endpoint: {endpoint}")
    logger.info(f"📦 Payload keys: {list(payload.keys())}")
    
    try:
        response = requests.post(url, json=payload, timeout=300)  # 5 minute timeout
        response.raise_for_status()
        
        result = response.json()
        logger.info(f"✅ Endpoint call successful: {endpoint}")
        logger.info(f"📄 Response keys: {list(result.keys()) if isinstance(result, dict) else 'Non-dict response'}")
        
        return result
        
    except requests.exceptions.Timeout:
        logger.error(f"⏰ Timeout calling {endpoint}")
        raise Exception(f"Timeout calling {endpoint}")
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Request failed for {endpoint}: {e}")
        raise Exception(f"Request failed for {endpoint}: {e}")
    except Exception as e:
        logger.error(f"❌ Unexpected error calling {endpoint}: {e}")
        raise

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=7200,  # 2 hours for the full synthesis process
    retries=0
)
def run_full_synthesis(user_id: str, model: str, start_date: str, end_date: str, user_instructions: str, session_id: str):
    """
    Complete workflow synthesis orchestrator using production API endpoints.
    Much simpler approach - orchestrates existing battle-tested endpoints.
    """
    logger.info(f"🚀 Starting full synthesis orchestrator for user {user_id}, session {session_id}")
    logger.info(f"📅 Time range: {start_date} to {end_date}")
    logger.info(f"🤖 Model: {model}")
    logger.info(f"📝 User instructions: {user_instructions[:100]}..." if user_instructions else "📝 No user instructions")
    
    try:
        # Step 1: Call the main synthesis endpoint
        update_progress(session_id, "Orchestrator (1/3): Starting workflow synthesis...", 10)
        logger.info("🎯 === STEP 1: CALLING SYNTHESIS ENDPOINT ===")
        
        synthesis_payload = {
            "model": model,
            "context": {
                "userId": user_id,
                "userInstructions": user_instructions
            },
            "startDate": start_date,
            "endDate": end_date
        }
        
        logger.info("🔄 Calling /api/synthesize-workflow...")
        synthesis_result = call_production_endpoint("/synthesize-workflow", synthesis_payload)
        
        # Extract workflows from the response
        workflows = synthesis_result.get("workflows", [])
        if not workflows:
            raise Exception("No workflows returned from synthesis endpoint")
        
        logger.info(f"✅ Synthesis complete - {len(workflows)} workflows generated")
        
        update_progress(session_id, "Orchestrator (1/3): Workflow synthesis completed", 50, {
            'synthesizedWorkflows': workflows,
            'workflowCount': len(workflows)
        })

        # Step 2: Save the results (if there's a save endpoint)
        update_progress(session_id, "Orchestrator (2/3): Processing results...", 70)
        logger.info("💾 === STEP 2: PROCESSING SYNTHESIS RESULTS ===")
        
        # The synthesis endpoint should have already saved the workflow
        # Just extract the important data for the final result
        first_workflow = workflows[0] if workflows else {}
        workflow_title = first_workflow.get("title", "Generated Workflow")
        
        logger.info(f"📊 Main workflow: {workflow_title}")
        
        update_progress(session_id, "Orchestrator (2/3): Results processed", 85, {
            'mainWorkflow': first_workflow,
            'workflowTitle': workflow_title
        })

        # Step 3: Finalize and complete
        update_progress(session_id, "Orchestrator (3/3): Finalizing...", 90)
        logger.info("🏁 === STEP 3: FINALIZING SYNTHESIS ===")
        
        # Create export filename
        export_filename = f"{workflow_title.replace(' ', '_').lower()}_workflow.yaml"
        
        # Final completion
        update_progress(session_id, "Complete", 100, {
            'success': True,
            'filename': export_filename,
            'workflows': workflows,
            'totalWorkflows': len(workflows),
            'mainWorkflowTitle': workflow_title
        })
        
        logger.info(f"🎉 Full synthesis completed successfully for session {session_id}")
        logger.info(f"📊 Final stats - {len(workflows)} workflows, Main: {workflow_title}")
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"❌ Full synthesis failed for session {session_id}: {error_msg}")
        logger.exception("Full exception details:")
        
        update_progress(session_id, f"Error: {error_msg}", -1)
        raise

    logger.info(f"🏁 Full synthesis orchestrator finished for session {session_id}") 