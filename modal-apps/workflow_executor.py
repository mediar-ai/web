"""
Modal App: Remote Workflow Executor
Executes cross-application automation workflows remotely
"""

import json
import time
import traceback
from datetime import datetime
from typing import Dict, Any, List, Optional
import os
import base64

import modal
from modal import Image, Secret, App

# Create Modal app
app = App("workflow-executor")

# Define the container image with required dependencies
image = (
    Image.debian_slim(python_version="3.11")
    .pip_install([
        "selenium==4.15.0",
        "requests==2.31.0", 
        "beautifulsoup4==4.12.2",
        "pillow==10.0.1",
        "supabase==2.0.0",
        "python-dotenv==1.0.0"
    ])
    .apt_install(["wget", "unzip", "chromium", "chromium-driver"])
)

@app.function(
    image=image,
    # secrets=[Secret.from_name("workflow-secrets")],  # Enable when secrets are configured
    timeout=600,  # 10 minutes max per workflow
    memory=2048,   # 2GB memory
)
def execute_workflow(execution_id: int, workflow_definition: Dict[str, Any], execution_params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute a workflow remotely and return results
    
    Args:
        execution_id: Database ID of the execution
        workflow_definition: Full workflow definition from deployed_workflows table
        execution_params: Input parameters from the client
        
    Returns:
        Dict containing execution results, logs, and screenshots
    """
    
    # Import here to avoid import errors in Modal's cold start
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from supabase import create_client
    import requests
    
    # Initialize execution tracking
    execution_logs = []
    screenshots = []
    results = {}
    start_time = time.time()
    
    def log_step(message: str, step_type: str = "info"):
        timestamp = datetime.now().isoformat()
        log_entry = f"[{timestamp}] {step_type.upper()}: {message}"
        execution_logs.append(log_entry)
        print(log_entry)
    
    def update_execution_status(status: str, error_message: str = None):
        """Update execution status in database"""
        try:
            supabase_url = os.environ.get("SUPABASE_URL")
            supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
            if supabase_url and supabase_key:
                supabase = create_client(supabase_url, supabase_key)
                update_data = {
                    "status": status,
                    "execution_logs": execution_logs,
                    "updated_at": datetime.now().isoformat()
                }
                if status == "running" and not error_message:
                    update_data["started_at"] = datetime.now().isoformat()
                elif status in ["completed", "failed"]:
                    update_data["completed_at"] = datetime.now().isoformat()
                    update_data["execution_duration_seconds"] = int(time.time() - start_time)
                    update_data["screenshots"] = screenshots
                    update_data["results"] = results
                    if error_message:
                        update_data["error_message"] = error_message
                
                supabase.table("workflow_executions").update(update_data).eq("id", execution_id).execute()
        except Exception as e:
            log_step(f"Failed to update execution status: {str(e)}", "error")
    
    try:
        log_step(f"Starting workflow execution {execution_id}")
        update_execution_status("running")
        
        # Get workflow steps
        automation_sequence = workflow_definition.get("automation_sequence", {})
        steps = automation_sequence.get("steps", [])
        
        if not steps:
            raise ValueError("No workflow steps found in automation sequence")
        
        log_step(f"Found {len(steps)} workflow steps to execute")
        
        # Setup Selenium WebDriver
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        
        driver = None
        
        try:
            driver = webdriver.Chrome(options=chrome_options)
            log_step("WebDriver initialized successfully")
            
            # Execute each workflow step
            for i, step in enumerate(steps):
                step_num = i + 1
                action = step.get("action", "")
                log_step(f"Executing step {step_num}/{len(steps)}: {action}")
                
                # Execute different types of actions
                if action == "navigate_browser":
                    url = step.get("url", "").format(**execution_params)
                    driver.get(url)
                    log_step(f"Navigated to: {url}")
                    time.sleep(2)  # Wait for page load
                    
                elif action == "fill_input":
                    selector = step.get("selector", "")
                    value = step.get("value", "").format(**execution_params)
                    element = WebDriverWait(driver, 10).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                    )
                    element.clear()
                    element.send_keys(value)
                    log_step(f"Filled input {selector} with value")
                    
                elif action == "click_element":
                    selector = step.get("selector", "")
                    element = WebDriverWait(driver, 10).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                    )
                    element.click()
                    log_step(f"Clicked element: {selector}")
                    time.sleep(1)
                    
                elif action == "select_dropdown":
                    selector = step.get("selector", "")
                    value = step.get("value", "").format(**execution_params)
                    from selenium.webdriver.support.ui import Select
                    element = WebDriverWait(driver, 10).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                    )
                    select = Select(element)
                    select.select_by_visible_text(value)
                    log_step(f"Selected dropdown option: {value}")
                    
                elif action == "wait_for_element":
                    selector = step.get("selector", "")
                    timeout = step.get("timeout", 10)
                    WebDriverWait(driver, timeout).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                    )
                    log_step(f"Successfully waited for element: {selector}")
                    
                elif action == "extract_data":
                    selector = step.get("selector", "")
                    attribute = step.get("attribute", "textContent")
                    result_key = step.get("result_key", f"extracted_data_{step_num}")
                    
                    elements = driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        if attribute == "textContent":
                            extracted_value = elements[0].text
                        else:
                            extracted_value = elements[0].get_attribute(attribute)
                        
                        results[result_key] = extracted_value
                        log_step(f"Extracted data for {result_key}: {extracted_value[:100]}...")
                    else:
                        log_step(f"Warning: No elements found for selector {selector}", "warning")
                
                elif action == "extract_multiple":
                    selector = step.get("selector", "")
                    attribute = step.get("attribute", "textContent")
                    result_key = step.get("result_key", f"extracted_list_{step_num}")
                    
                    elements = driver.find_elements(By.CSS_SELECTOR, selector)
                    extracted_values = []
                    
                    for element in elements:
                        if attribute == "textContent":
                            extracted_values.append(element.text)
                        else:
                            extracted_values.append(element.get_attribute(attribute))
                    
                    results[result_key] = extracted_values
                    log_step(f"Extracted {len(extracted_values)} items for {result_key}")
                
                elif action == "take_screenshot":
                    screenshot_name = step.get("name", f"step_{step_num}")
                    screenshot_data = driver.get_screenshot_as_base64()
                    screenshots.append({
                        "name": screenshot_name,
                        "step": step_num,
                        "data": screenshot_data,
                        "timestamp": datetime.now().isoformat()
                    })
                    log_step(f"Screenshot captured: {screenshot_name}")
                
                elif action == "custom_wait":
                    duration = step.get("duration", 2)
                    time.sleep(duration)
                    log_step(f"Waited {duration} seconds")
                
                else:
                    log_step(f"Unknown action: {action}", "warning")
                
                # Take automatic screenshot every few steps
                if step_num % 3 == 0:
                    auto_screenshot = driver.get_screenshot_as_base64()
                    screenshots.append({
                        "name": f"auto_step_{step_num}",
                        "step": step_num,
                        "data": auto_screenshot,
                        "timestamp": datetime.now().isoformat()
                    })
            
            log_step("Workflow execution completed successfully")
            
            # Final screenshot
            if driver:
                final_screenshot = driver.get_screenshot_as_base64()
                screenshots.append({
                    "name": "final_result",
                    "step": len(steps) + 1,
                    "data": final_screenshot,
                    "timestamp": datetime.now().isoformat()
                })
            
            update_execution_status("completed")
            
            return {
                "success": True,
                "execution_id": execution_id,
                "results": results,
                "execution_logs": execution_logs,
                "screenshots": screenshots,
                "execution_duration_seconds": int(time.time() - start_time),
                "steps_completed": len(steps)
            }
            
        finally:
            if driver:
                driver.quit()
                log_step("WebDriver closed")
    
    except Exception as e:
        error_message = f"Workflow execution failed: {str(e)}\n{traceback.format_exc()}"
        log_step(error_message, "error")
        update_execution_status("failed", error_message)
        
        return {
            "success": False,
            "execution_id": execution_id,
            "error": str(e),
            "execution_logs": execution_logs,
            "screenshots": screenshots,
            "execution_duration_seconds": int(time.time() - start_time)
        }

@app.function(
    # secrets=[Secret.from_name("workflow-secrets")],  # Enable when secrets are configured
    timeout=60
)
def get_workflow_queue_status() -> Dict[str, Any]:
    """Get current workflow execution queue status"""
    try:
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("Supabase credentials not configured")
        
        from supabase import create_client
        supabase = create_client(supabase_url, supabase_key)
        
        # Get queue statistics
        queued = supabase.table("workflow_executions").select("id").eq("status", "queued").execute()
        running = supabase.table("workflow_executions").select("id").eq("status", "running").execute()
        
        return {
            "queued_count": len(queued.data),
            "running_count": len(running.data),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

if __name__ == "__main__":
    # For local testing
    print("Workflow executor Modal app configured")
