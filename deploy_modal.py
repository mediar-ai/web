#!/usr/bin/env python3
"""Deploy Modal workflow executor with proper encoding."""

import os
import sys
import subprocess

# Set up environment
os.environ['PYTHONPATH'] = '.'
os.environ['PYTHONIOENCODING'] = 'utf-8'

print("Deploying Modal workflow executor with parser output fix...")
print("=" * 60)

# Run modal deploy with Windows encoding workaround
try:
    # First, let's check if modal is available
    check_modal = subprocess.run(
        [sys.executable, '-m', 'modal', '--version'],
        capture_output=True,
        text=False  # Get bytes
    )

    if check_modal.returncode != 0:
        print("Modal CLI not found. Installing modal...")
        subprocess.run([sys.executable, '-m', 'pip', 'install', 'modal'])

    # Now run the actual deployment
    print("Running deployment...")

    # Use shell=True on Windows to avoid encoding issues
    if os.name == 'nt':  # Windows
        cmd = f'"{sys.executable}" -m modal deploy modal_apps/workflow_executor.py'
        process = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}
        )

        # Read output line by line
        for line in iter(process.stdout.readline, b''):
            try:
                # Try UTF-8 first, then fallback
                decoded = line.decode('utf-8', errors='replace').rstrip()
                # Replace problematic characters
                decoded = decoded.replace('\u2713', '[OK]').replace('\u2717', '[X]')
                print(decoded)
            except:
                # Last resort - print raw
                print(line.decode('ascii', errors='ignore').rstrip())

        process.wait()
        returncode = process.returncode
    else:
        # Non-Windows systems
        result = subprocess.run(
            [sys.executable, '-m', 'modal', 'deploy', 'modal_apps/workflow_executor.py'],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        print(result.stdout)
        if result.stderr:
            print("Errors/Warnings:", result.stderr)
        returncode = result.returncode

    if returncode == 0:
        print("\n" + "=" * 60)
        print("Deployment completed successfully!")
        print("Parser output will now be fully preserved in the database.")
    else:
        print(f"\nDeployment failed with return code: {returncode}")
        sys.exit(1)

except Exception as e:
    print(f"Error during deployment: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)