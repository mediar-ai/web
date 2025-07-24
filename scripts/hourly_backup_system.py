#!/usr/bin/env python3
"""
Hourly PostgreSQL Database Backup System (Cloud-Only)
Streams backups directly to cloud storage without local storage
"""
import os
import subprocess
import psycopg2
from datetime import datetime, timedelta
import logging
import argparse
from pathlib import Path
import tempfile

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/tmp/backup.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class CloudOnlyBackupManager:
    def __init__(self, config):
        self.config = config
        
    def get_connection(self):
        """Establish database connection"""
        return psycopg2.connect(self.config['connection_string'])
    
    def get_database_size(self):
        """Get database size for monitoring"""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT pg_size_pretty(pg_database_size(current_database()));")
            size = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            return size
        except Exception as e:
            logger.error(f"Failed to get database size: {e}")
            return "Unknown"
    
    def create_backup_direct_to_s3(self):
        """Create PostgreSQL backup and stream directly to S3"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Extract connection details
        conn_parts = self.config['connection_string'].replace('postgresql://', '').split('@')
        user_pass = conn_parts[0].split(':')
        host_port_db = conn_parts[1].split('/')
        host_port = host_port_db[0].split(':')
        
        username = user_pass[0]
        password = user_pass[1] if len(user_pass) > 1 else ''
        host = host_port[0]
        port = host_port[1] if len(host_port) > 1 else '5432'
        database = host_port_db[1] if len(host_port_db) > 1 else 'postgres'
        
        # S3 path
        s3_path = f"s3://{self.config['s3_bucket']}/hourly-backups/backup_{timestamp}.custom"
        
        # Create pg_dump command that pipes to aws s3 cp
        pg_dump_cmd = [
            'pg_dump',
            '-Fc',  # Custom format (compressed)
            '-h', host,
            '-p', port,
            '-U', username,
            '-d', database
        ]
        
        aws_cmd = [
            'aws', 's3', 'cp',
            '-',  # Read from stdin
            s3_path
        ]
        
        # Set password environment variable
        env = os.environ.copy()
        env['PGPASSWORD'] = password
        
        try:
            logger.info(f"🚀 Starting backup stream to S3: backup_{timestamp}.custom")
            logger.info(f"📊 Database size: {self.get_database_size()}")
            
            # Create pipe: pg_dump | aws s3 cp
            pg_dump_proc = subprocess.Popen(
                pg_dump_cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            aws_proc = subprocess.Popen(
                aws_cmd,
                stdin=pg_dump_proc.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # Close pg_dump stdout to allow it to receive SIGPIPE
            pg_dump_proc.stdout.close()
            
            # Wait for both processes
            aws_stdout, aws_stderr = aws_proc.communicate()
            pg_dump_proc.wait()
            
            if pg_dump_proc.returncode == 0 and aws_proc.returncode == 0:
                logger.info(f"✅ Backup streamed successfully to S3: {s3_path}")
                return s3_path
            else:
                if pg_dump_proc.returncode != 0:
                    _, pg_dump_stderr = pg_dump_proc.communicate()
                    logger.error(f"❌ pg_dump failed: {pg_dump_stderr.decode()}")
                if aws_proc.returncode != 0:
                    logger.error(f"❌ AWS S3 upload failed: {aws_stderr}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Backup failed: {e}")
            return None
    
    def cleanup_old_s3_backups(self, retention_hours=168):
        """Remove old backups from S3"""
        try:
            cutoff_time = datetime.now() - timedelta(hours=retention_hours)
            cutoff_timestamp = cutoff_time.strftime('%Y%m%d_%H%M%S')
            
            # List objects in S3 bucket
            cmd = [
                'aws', 's3api', 'list-objects-v2',
                '--bucket', self.config['s3_bucket'],
                '--prefix', 'hourly-backups/backup_',
                '--query', f'Contents[?LastModified<=`{cutoff_time.isoformat()}`].Key',
                '--output', 'text'
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0 and result.stdout.strip():
                old_files = result.stdout.strip().split('\n')
                removed_count = 0
                
                for file_key in old_files:
                    if file_key and file_key != 'None':
                        delete_cmd = [
                            'aws', 's3', 'rm',
                            f"s3://{self.config['s3_bucket']}/{file_key}"
                        ]
                        
                        delete_result = subprocess.run(delete_cmd, capture_output=True, text=True)
                        if delete_result.returncode == 0:
                            removed_count += 1
                            logger.info(f"🗑️  Removed old backup: {file_key}")
                
                if removed_count > 0:
                    logger.info(f"🧹 Cleanup completed: Removed {removed_count} old backups from S3")
                else:
                    logger.info("🧹 Cleanup completed: No old backups to remove")
            else:
                logger.info("🧹 Cleanup completed: No old backups found")
                
        except Exception as e:
            logger.error(f"❌ S3 cleanup failed: {e}")
    
    def run_backup(self, cleanup=True):
        """Run complete cloud-only backup process"""
        logger.info("🔄 Starting hourly cloud backup process")
        
        # Verify S3 bucket is configured
        if not self.config.get('s3_bucket'):
            logger.error("❌ S3 bucket not configured")
            return False
        
        # Create backup and stream to S3
        backup_path = self.create_backup_direct_to_s3()
        if not backup_path:
            return False
        
        # Cleanup old backups
        if cleanup:
            self.cleanup_old_s3_backups(self.config.get('retention_hours', 168))
        
        logger.info("✅ Hourly cloud backup process completed successfully")
        return True

def main():
    parser = argparse.ArgumentParser(description='PostgreSQL Hourly Cloud Backup System')
    parser.add_argument('--no-cleanup', action='store_true',
                       help='Skip cleanup of old backups')
    parser.add_argument('--test', action='store_true',
                       help='Test connection only')
    
    args = parser.parse_args()
    
    # Configuration
    config = {
        'connection_string': "postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
        'retention_hours': 168,  # 7 days
        's3_bucket': os.getenv('S3_BACKUP_BUCKET'),
    }
    
    # Validate S3 bucket
    if not config['s3_bucket']:
        logger.error("❌ S3_BACKUP_BUCKET environment variable not set")
        print("Please set: export S3_BACKUP_BUCKET=your-bucket-name")
        exit(1)
    
    backup_manager = CloudOnlyBackupManager(config)
    
    if args.test:
        try:
            conn = backup_manager.get_connection()
            size = backup_manager.get_database_size()
            conn.close()
            logger.info(f"✅ Connection test successful. Database size: {size}")
            
            # Test AWS CLI
            test_cmd = ['aws', 's3', 'ls', f"s3://{config['s3_bucket']}/"]
            result = subprocess.run(test_cmd, capture_output=True, text=True)
            if result.returncode == 0:
                logger.info("✅ AWS S3 access test successful")
            else:
                logger.error(f"❌ AWS S3 access test failed: {result.stderr}")
                
        except Exception as e:
            logger.error(f"❌ Connection test failed: {e}")
        return
    
    # Run backup
    success = backup_manager.run_backup(cleanup=not args.no_cleanup)
    
    if not success:
        exit(1)

if __name__ == "__main__":
    main() 