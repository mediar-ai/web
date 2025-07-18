#!/usr/bin/env python3
"""
Register Current Machine for Multi-Machine Support

This script registers the current machine configuration into the new multi-machine
system to ensure backward compatibility. It extracts the current MCP and management
endpoints from the existing configuration and creates a machine record.

Usage: python scripts/register_current_machine.py [--dry-run]
"""

import os
import sys
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
import argparse
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

def get_db_connection():
    """Get database connection from environment variables"""
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        raise ValueError("SUPABASE_CONN_STRING environment variable not set in .env.local")
    
    conn = psycopg2.connect(conn_string)
    return conn

def extract_current_machine_config():
    """Extract current machine configuration from workflow executor"""
    
    # Default configuration from current workflow_executor.py
    current_config = {
        "name": "Primary Windows VM",
        "description": "Primary Windows VM for browser automation (migrated from single-machine setup)",
        "mcp_endpoint": "https://mcp-server-1.ngrok.app",
        "management_endpoint": "https://vm-windows-1.ngrok.dev", 
        "health_endpoint": "https://vm-windows-1.ngrok.dev/health",
        "machine_type": "windows_vm",
        "capabilities": {
            "browsers": ["chrome", "firefox", "edge"],
            "automation_tools": ["terminator-mcp-agent"],
            "screen_resolution": "1920x1080",
            "rdp_enabled": True,
            "ngrok_tunneling": True
        },
        "max_concurrent_executions": 1,
        "priority": 1,  # Highest priority as primary machine
        "region": "US-West",
        "tags": ["primary", "windows", "browser-automation", "production"]
    }
    
    print("📋 Detected current machine configuration:")
    print(f"  Name: {current_config['name']}")
    print(f"  MCP Endpoint: {current_config['mcp_endpoint']}")
    print(f"  Management Endpoint: {current_config['management_endpoint']}")
    print(f"  Machine Type: {current_config['machine_type']}")
    print(f"  Max Concurrent: {current_config['max_concurrent_executions']}")
    
    return current_config

def check_machine_health(mcp_endpoint, management_endpoint):
    """Check if the machine endpoints are accessible"""
    health_results = {
        "mcp": {"status": "unknown", "error": None},
        "management": {"status": "unknown", "error": None}
    }
    
    # Test MCP endpoint
    try:
        mcp_health_url = f"{mcp_endpoint}/health"
        response = requests.get(mcp_health_url, headers={"ngrok-skip-browser-warning": "true"}, timeout=10)
        if response.status_code == 200:
            health_results["mcp"]["status"] = "healthy"
            print(f"✅ MCP endpoint is healthy: {mcp_health_url}")
        else:
            health_results["mcp"]["status"] = "unhealthy"
            health_results["mcp"]["error"] = f"HTTP {response.status_code}"
            print(f"⚠️ MCP endpoint returned {response.status_code}: {mcp_health_url}")
    except Exception as e:
        health_results["mcp"]["status"] = "unreachable"
        health_results["mcp"]["error"] = str(e)
        print(f"❌ MCP endpoint unreachable: {e}")
    
    # Test Management endpoint
    try:
        mgmt_health_url = f"{management_endpoint}/health"
        response = requests.get(mgmt_health_url, headers={"ngrok-skip-browser-warning": "true"}, timeout=10)
        if response.status_code == 200:
            health_results["management"]["status"] = "healthy"
            print(f"✅ Management endpoint is healthy: {mgmt_health_url}")
        else:
            health_results["management"]["status"] = "unhealthy"
            health_results["management"]["error"] = f"HTTP {response.status_code}"
            print(f"⚠️ Management endpoint returned {response.status_code}: {mgmt_health_url}")
    except Exception as e:
        health_results["management"]["status"] = "unreachable"
        health_results["management"]["error"] = str(e)
        print(f"❌ Management endpoint unreachable: {e}")
    
    # Determine overall health
    overall_status = "healthy" if (
        health_results["mcp"]["status"] == "healthy" and 
        health_results["management"]["status"] == "healthy"
    ) else "unhealthy"
    
    return overall_status, health_results

def check_existing_machine(conn, machine_name):
    """Check if a machine with this name already exists"""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM remote_machines WHERE name = %s", (machine_name,))
        existing = cur.fetchone()
        return dict(existing) if existing else None
    finally:
        cur.close()

def register_machine(conn, machine_config, health_status, health_details, dry_run=False):
    """Register the machine in the database"""
    
    if dry_run:
        print("\n🔍 DRY RUN - Would register machine with the following data:")
        print(json.dumps(machine_config, indent=2))
        print(f"Health Status: {health_status}")
        print(f"Health Details: {json.dumps(health_details, indent=2)}")
        return None
    
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Prepare machine data
        machine_data = {
            "name": machine_config["name"],
            "description": machine_config["description"],
            "mcp_endpoint": machine_config["mcp_endpoint"],
            "management_endpoint": machine_config["management_endpoint"],
            "health_endpoint": machine_config["health_endpoint"],
            "machine_type": machine_config["machine_type"],
            "capabilities": json.dumps(machine_config["capabilities"]),
            "max_concurrent_executions": machine_config["max_concurrent_executions"],
            "priority": machine_config["priority"],
            "region": machine_config["region"],
            "tags": machine_config["tags"],
            "status": "active",
            "health_status": health_status,
            "health_details": json.dumps(health_details),
            "last_health_check": datetime.now(),
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        }
        
        # Insert machine
        insert_query = """
            INSERT INTO remote_machines (
                name, description, mcp_endpoint, management_endpoint, health_endpoint,
                machine_type, capabilities, max_concurrent_executions, priority,
                region, tags, status, health_status, health_details,
                last_health_check, created_at, updated_at
            ) VALUES (
                %(name)s, %(description)s, %(mcp_endpoint)s, %(management_endpoint)s, %(health_endpoint)s,
                %(machine_type)s, %(capabilities)s, %(max_concurrent_executions)s, %(priority)s,
                %(region)s, %(tags)s, %(status)s, %(health_status)s, %(health_details)s,
                %(last_health_check)s, %(created_at)s, %(updated_at)s
            ) RETURNING *
        """
        
        cur.execute(insert_query, machine_data)
        machine = cur.fetchone()
        conn.commit()
        
        print(f"\n✅ Successfully registered machine '{machine['name']}' with ID {machine['id']}")
        return dict(machine)
        
    except psycopg2.IntegrityError as e:
        conn.rollback()
        if "unique constraint" in str(e).lower():
            raise ValueError(f"Machine with name '{machine_config['name']}' already exists")
        else:
            raise e
    finally:
        cur.close()

def add_default_configurations(conn, machine_id, dry_run=False):
    """Add default machine configurations"""
    
    default_configs = [
        {
            "config_type": "browser_settings",
            "config_name": "default_browser",
            "config_data": {
                "default_browser": "chrome",
                "headless": False,
                "window_size": "1920x1080",
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            "is_sensitive": False
        },
        {
            "config_type": "environment",
            "config_name": "paths",
            "config_data": {
                "chrome_path": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "firefox_path": "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
                "screenshots_path": "C:\\temp\\screenshots"
            },
            "is_sensitive": False
        },
        {
            "config_type": "automation",
            "config_name": "mcp_settings",
            "config_data": {
                "transport": "http",
                "port": 3000,
                "timeout_seconds": 300,
                "max_retries": 3
            },
            "is_sensitive": False
        }
    ]
    
    if dry_run:
        print(f"\n🔍 DRY RUN - Would add {len(default_configs)} default configurations:")
        for config in default_configs:
            print(f"  - {config['config_type']}: {config['config_name']}")
        return []
    
    cur = conn.cursor(cursor_factory=RealDictCursor)
    created_configs = []
    
    try:
        for config in default_configs:
            config_data = {
                "machine_id": machine_id,
                "config_type": config["config_type"],
                "config_name": config["config_name"],
                "config_data": json.dumps(config["config_data"]),
                "is_sensitive": config["is_sensitive"],
                "version": 1,
                "is_active": True,
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            }
            
            insert_config_query = """
                INSERT INTO machine_configurations (
                    machine_id, config_type, config_name, config_data,
                    is_sensitive, version, is_active, created_at, updated_at
                ) VALUES (
                    %(machine_id)s, %(config_type)s, %(config_name)s, %(config_data)s,
                    %(is_sensitive)s, %(version)s, %(is_active)s, %(created_at)s, %(updated_at)s
                ) RETURNING *
            """
            
            cur.execute(insert_config_query, config_data)
            created_config = cur.fetchone()
            created_configs.append(dict(created_config))
            
            print(f"  ✅ Added configuration: {config['config_type']}/{config['config_name']}")
        
        conn.commit()
        print(f"\n✅ Successfully added {len(created_configs)} default configurations")
        return created_configs
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error adding configurations: {e}")
        return []
    finally:
        cur.close()

def update_existing_workflows_backward_compatibility(conn, machine_id, dry_run=False):
    """Update existing workflow executions to reference the registered machine"""
    
    if dry_run:
        print("\n🔍 DRY RUN - Would update existing workflow executions to reference the new machine")
        return
    
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Update existing executions that don't have a machine assigned
        update_query = """
            UPDATE workflow_executions 
            SET assigned_machine_id = %s,
                assignment_reason = 'Backward compatibility - assigned to primary machine',
                assignment_method = 'migration'
            WHERE assigned_machine_id IS NULL
            AND status IN ('completed', 'failed')
        """
        
        cur.execute(update_query, (machine_id,))
        updated_count = cur.rowcount
        conn.commit()
        
        if updated_count > 0:
            print(f"\n✅ Updated {updated_count} existing workflow executions with machine assignment")
        else:
            print("\n📋 No existing executions needed machine assignment")
            
    except Exception as e:
        conn.rollback()
        print(f"❌ Error updating existing executions: {e}")
    finally:
        cur.close()

def main():
    parser = argparse.ArgumentParser(description="Register current machine for multi-machine support")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--force", action="store_true", help="Update existing machine if it already exists")
    parser.add_argument("--name", default="Primary Windows VM", help="Name for the machine (default: Primary Windows VM)")
    
    args = parser.parse_args()
    
    print("🚀 Starting machine registration for multi-machine support")
    print("=" * 60)
    
    try:
        # Extract current configuration
        machine_config = extract_current_machine_config()
        machine_config["name"] = args.name  # Allow custom name
        
        # Check machine health
        print("\n🏥 Checking machine health...")
        health_status, health_details = check_machine_health(
            machine_config["mcp_endpoint"],
            machine_config["management_endpoint"]
        )
        
        # Connect to database
        print("\n🔗 Connecting to database...")
        conn = get_db_connection()
        
        # Check if machine already exists
        existing_machine = check_existing_machine(conn, machine_config["name"])
        
        if existing_machine:
            if args.force:
                print(f"\n⚠️ Machine '{machine_config['name']}' already exists (ID: {existing_machine['id']})")
                print("🔄 Force flag provided - updating existing machine...")
                
                if not args.dry_run:
                    cur = conn.cursor()
                    try:
                        update_query = """
                            UPDATE remote_machines 
                            SET health_status = %s,
                                health_details = %s,
                                last_health_check = NOW(),
                                updated_at = NOW()
                            WHERE id = %s
                        """
                        cur.execute(update_query, (health_status, json.dumps(health_details), existing_machine['id']))
                        conn.commit()
                        print(f"✅ Updated existing machine health status")
                    finally:
                        cur.close()
                
                machine_id = existing_machine['id']
            else:
                print(f"\n⚠️ Machine '{machine_config['name']}' already exists (ID: {existing_machine['id']})")
                print("💡 Use --force to update the existing machine, or choose a different --name")
                return
        else:
            # Register new machine
            print(f"\n🔧 Registering machine '{machine_config['name']}'...")
            machine = register_machine(conn, machine_config, health_status, health_details, args.dry_run)
            machine_id = machine['id'] if machine else 1  # Use 1 for dry run
        
        # Add default configurations
        print(f"\n⚙️ Adding default configurations...")
        add_default_configurations(conn, machine_id, args.dry_run)
        
        # Update existing workflows for backward compatibility
        print(f"\n🔄 Updating existing workflows for backward compatibility...")
        update_existing_workflows_backward_compatibility(conn, machine_id, args.dry_run)
        
        print("\n" + "=" * 60)
        if args.dry_run:
            print("🔍 DRY RUN COMPLETED - No changes were made")
            print("💡 Run without --dry-run to actually register the machine")
        else:
            print("✅ MACHINE REGISTRATION COMPLETED SUCCESSFULLY!")
            print(f"🎉 Machine '{machine_config['name']}' is now registered in the multi-machine system")
            print(f"📊 Machine ID: {machine_id}")
            print(f"🏥 Health Status: {health_status}")
            
            print("\n📋 Next Steps:")
            print("  1. The unified workflow executor is already deployed and handles machine routing")
            print("  2. Test workflow execution with the new system")
            print("  3. Register additional machines as needed")
            print("  4. Configure workflow-to-machine assignments via API")
        
    except Exception as e:
        print(f"\n❌ Error during machine registration: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main()) 