#!/usr/bin/env python3
"""Fix Unicode/emoji issues in workflow_executor.py that cause charmap encoding errors on Windows"""

import re

def fix_unicode_in_file(filepath):
    """Remove emojis from log statements to fix Windows encoding issues"""

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Track changes
    original = content

    # Remove specific emojis from logging statements
    replacements = [
        ('⏰ Start Time:', 'Start Time:'),
        ('✅ Alert check triggered', 'Alert check triggered'),
        ('❌ Failed to trigger', 'Failed to trigger'),
        ('⏰ Starting scheduled', 'Starting scheduled'),
        ('⏸  ', ''),  # Remove pause emoji with extra space
        ('⏸ ', ''),  # Remove pause emoji
    ]

    for old, new in replacements:
        content = content.replace(old, new)

    # Write back if changes were made
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed Unicode issues in {filepath}")
        print("Removed emojis from logging statements to prevent charmap encoding errors")
        return True
    else:
        print(f"No changes needed in {filepath}")
        return False

if __name__ == "__main__":
    # Fix workflow_executor.py
    fix_unicode_in_file("modal_apps/workflow_executor.py")

    # Also fix labeling_data_processor.py if it has the same issue
    fix_unicode_in_file("modal_apps/labeling_data_processor.py")