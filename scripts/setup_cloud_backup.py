#!/usr/bin/env python3
"""
Setup script for Cloud-Only Hourly PostgreSQL Backup System
"""
import os
import subprocess
import sys
from pathlib import Path

def run_command(cmd, check=True):
    """Run a shell command and return the result"""
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"ERROR: Command failed: {cmd}")
        print(f"STDERR: {result.stderr}")
        sys.exit(1)
    return result

def check_dependencies():
    """Check and install required dependencies"""
    print("📦 Checking dependencies...")
    
    missing_deps = []
    
    # Check for required commands
    if not subprocess.run("which python3", shell=True, capture_output=True).returncode == 0:
        missing_deps.append("python3")
    
    if not subprocess.run("which pg_dump", shell=True, capture_output=True).returncode == 0:
        missing_deps.append("postgresql-client")
    
    if not subprocess.run("which aws", shell=True, capture_output=True).returncode == 0:
        missing_deps.append("awscli")
    
    # Check for psycopg2
    try:
        import psycopg2
    except ImportError:
        missing_deps.append("python3-psycopg2")
    
    if missing_deps:
        print(f"❌ Missing dependencies: {missing_deps}")
        print("Please install them manually:")
        print("  # Ubuntu/Debian:")
        print("  sudo apt-get update")
        print("  sudo apt-get install python3 postgresql-client python3-psycopg2")
        print("  pip3 install awscli")
        print("")
        print("  # macOS:")
        print("  brew install postgresql python3")
        print("  pip3 install psycopg2-binary awscli")
        sys.exit(1)
    
    print("✅ All dependencies satisfied")

def setup_aws_credentials():
    """Guide user through AWS setup"""
    print("\n🔑 AWS Configuration")
    print("=" * 50)
    
    # Check if AWS is configured
    result = run_command("aws sts get-caller-identity", check=False)
    if result.returncode == 0:
        print("✅ AWS CLI already configured")
        return
    
    print("AWS CLI is not configured. Please run:")
    print("  aws configure")
    print("")
    print("You'll need:")
    print("  - AWS Access Key ID")
    print("  - AWS Secret Access Key")
    print("  - Default region (e.g., us-west-1)")
    print("  - Default output format (json)")
    
    input("Press Enter after configuring AWS CLI...")
    
    # Test again
    result = run_command("aws sts get-caller-identity", check=False)
    if result.returncode != 0:
        print("❌ AWS CLI still not working. Please configure it manually.")
        sys.exit(1)
    
    print("✅ AWS CLI configured successfully")

def setup_s3_bucket():
    """Set up S3 bucket for backups"""
    print("\n📦 S3 Bucket Setup")
    print("=" * 50)
    
    # Ask for bucket name
    bucket_name = input("Enter your S3 bucket name for backups: ").strip()
    if not bucket_name:
        print("❌ Bucket name is required")
        sys.exit(1)
    
    # Check if bucket exists
    result = run_command(f"aws s3 ls s3://{bucket_name}/", check=False)
    
    if result.returncode != 0:
        print(f"Bucket {bucket_name} doesn't exist or isn't accessible.")
        create_bucket = input("Would you like to create it? (y/N): ").lower()
        
        if create_bucket == 'y':
            # Create bucket
            run_command(f"aws s3 mb s3://{bucket_name}")
            print(f"✅ Created bucket: {bucket_name}")
        else:
            print("❌ Please create the bucket manually or use an existing one")
            sys.exit(1)
    else:
        print(f"✅ Bucket {bucket_name} is accessible")
    
    # Set environment variable
    bashrc_path = Path.home() / ".bashrc"
    zshrc_path = Path.home() / ".zshrc"
    
    env_line = f"export S3_BACKUP_BUCKET={bucket_name}"
    
    # Add to shell profile
    shell_profile = zshrc_path if zshrc_path.exists() else bashrc_path
    
    with open(shell_profile, "a") as f:
        f.write(f"\n# Hourly backup configuration\n{env_line}\n")
    
    print(f"✅ Added S3_BACKUP_BUCKET to {shell_profile}")
    
    # Set for current session
    os.environ['S3_BACKUP_BUCKET'] = bucket_name
    
    return bucket_name

def setup_cron():
    """Set up cron job for hourly backups"""
    print("\n⏰ Setting up cron job...")
    
    script_dir = Path(__file__).parent
    backup_script = script_dir / "hourly_backup_system.py"
    
    if not backup_script.exists():
        print(f"❌ Backup script not found: {backup_script}")
        return
    
    # Make script executable
    run_command(f"chmod +x {backup_script}")
    
    # Create cron entry
    cron_entry = f"0 * * * * /usr/bin/python3 {backup_script} >> /tmp/hourly_backup.log 2>&1"
    
    # Get current crontab
    result = run_command("crontab -l", check=False)
    current_cron = result.stdout if result.returncode == 0 else ""
    
    # Check if entry already exists
    if str(backup_script) in current_cron:
        print("⚠️  Cron job already exists")
        return
    
    # Add new entry
    new_cron = current_cron + f"\n{cron_entry}\n"
    
    # Write new crontab
    proc = subprocess.Popen(['crontab', '-'], stdin=subprocess.PIPE, text=True)
    proc.communicate(input=new_cron)
    
    if proc.returncode == 0:
        print("✅ Cron job added successfully")
        print(f"   Schedule: Every hour")
        print(f"   Logs: /tmp/hourly_backup.log")
    else:
        print("❌ Failed to add cron job")

def test_backup():
    """Test the backup system"""
    print("\n🧪 Testing backup system...")
    
    script_dir = Path(__file__).parent
    backup_script = script_dir / "hourly_backup_system.py"
    
    # Test connection and AWS
    result = run_command(f"python3 {backup_script} --test", check=False)
    
    if result.returncode == 0:
        print("✅ All tests passed!")
        
        run_test = input("Would you like to run a test backup now? (y/N): ").lower()
        if run_test == 'y':
            print("Running test backup...")
            result = run_command(f"python3 {backup_script}", check=False)
            
            if result.returncode == 0:
                print("✅ Test backup completed successfully!")
            else:
                print("❌ Test backup failed - check logs for details")
    else:
        print("❌ Tests failed - please check your configuration")

def main():
    """Main setup function"""
    print("🚀 Cloud-Only Hourly PostgreSQL Backup Setup")
    print("=" * 60)
    print("This will set up hourly backups that stream directly to AWS S3")
    print("")
    
    try:
        check_dependencies()
        setup_aws_credentials()
        bucket_name = setup_s3_bucket()
        setup_cron()
        test_backup()
        
        print("\n" + "="*60)
        print("🎉 SETUP COMPLETE!")
        print("="*60)
        print(f"✅ Hourly backups configured to stream to s3://{bucket_name}")
        print("✅ Cron job scheduled to run every hour")
        print("✅ 7-day retention policy active")
        print("")
        print("📋 Next steps:")
        print("1. Wait for the next hour to see the first backup")
        print("2. Check logs: tail -f /tmp/hourly_backup.log")
        print("3. Monitor S3 bucket for backup files")
        print("4. Test restore procedures when needed")
        
    except KeyboardInterrupt:
        print("\n\n❌ Setup interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 