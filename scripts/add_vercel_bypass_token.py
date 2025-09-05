#!/usr/bin/env python3

import subprocess
import sys

def add_bypass_token():
    """Add Vercel bypass token to enable cron to work"""
    
    print("\n" + "="*80)
    print("ADDING VERCEL BYPASS TOKEN")
    print("="*80)
    
    print("\nTo make cron work, we need to add a Vercel bypass token.")
    print("\n1. Go to: https://vercel.com/louis030195s-projects/browser-workflow-capture-app/settings/environment-variables")
    print("\n2. Add this environment variable:")
    print("   Name: VERCEL_AUTOMATION_BYPASS_SECRET")
    print("   Value: (Generate at https://vercel.com/louis030195s-projects/browser-workflow-capture-app/settings/deployment-protection)")
    print("\n3. Click 'Generate Secret' on the deployment protection page")
    print("4. Copy the secret and add it as the environment variable")
    print("\n5. Redeploy for changes to take effect")
    
    print("\n" + "="*80)
    print("ALTERNATIVE: DISABLE DEPLOYMENT PROTECTION")
    print("="*80)
    
    print("\nIf you prefer, you can disable deployment protection entirely:")
    print("1. Go to: https://vercel.com/louis030195s-projects/browser-workflow-capture-app/settings/deployment-protection")
    print("2. Toggle OFF 'Vercel Authentication'")
    print("3. Save changes")
    
    print("\nThis will allow cron to call your API endpoints without authentication.")

if __name__ == "__main__":
    add_bypass_token()

