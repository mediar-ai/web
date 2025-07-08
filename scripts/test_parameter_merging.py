import collections.abc
import json

def deep_merge(d, u):
    """
    Recursively merge dictionaries.
    'd' is the dictionary to be updated, 'u' is the dictionary with new values.
    """
    for k, v in u.items():
        if isinstance(v, collections.abc.Mapping):
            d[k] = deep_merge(d.get(k, {}), v)
        else:
            d[k] = v
    return d

# 1. The full workflow definition, matching the structure of the JSON file
full_workflow_json = {
    "tool_name": "execute_sequence",
    "arguments": {
        "variables": {
            "url": "https://v2preview.online.bestplanpro.com/",
            "registration": {
                "key": "4WV-HJR-SA9",
                "email": "louis@mediar.ai"
            },
            "applicant": {
                "dob": "01/15/1985",
                "height": "6'06",
                "weight": "200",
                "select_male": True,
                "state": "California",
                "zip_code": "90210",
                "select_tobacco_no": True
            },
            "policy": {
                "face_amount": "$100,000",
                "coverage_type": "Best Case: Graded Coverage"
            },
            "selectors": {
                "eula_accept_button": "role:Button|name:Accept"
                # Selectors are numerous, one is included for structural accuracy
            }
        },
        "items": [
            {
                "tool_name": "navigate_browser",
                "arguments": {
                    "url": "{{url}}"
                }
            }
            # Other items omitted for brevity
        ]
    }
}


# 2. Execution parameters from the frontend test run log
execution_params = {
    "state": "California",
    "gender": "Male",
    "height": "5'10\"",
    "weight": "180",
    "zip_code": "90210",
    "face_value": "250000",
    "date_of_birth": "01/15/1985",
    "nicotine_usage": "Never"
}

# --- Test Simulation ---

# In the real script, we would start with the full arguments object
original_arguments = full_workflow_json['arguments']

# We operate on a copy to keep the original intact for comparison
# The 'deep_merge' will modify this object in place.
arguments_to_be_merged = json.loads(json.dumps(original_arguments)) # simple deep copy

# The merge happens on the nested 'variables' dictionary
merged_variables = deep_merge(arguments_to_be_merged['variables'], execution_params)


# --- Test Output ---
print("="*80)
print("End-to-End Test for Deep Merge Function (Accurate Structure)")
print("="*80)
print("\n[1] ORIGINAL WORKFLOW ARGUMENTS (From JSON):")
print(json.dumps(original_arguments, indent=2))

print("\n" + "-"*80)
print("\n[2] EXECUTION PARAMETERS (From Frontend):")
print(json.dumps(execution_params, indent=2))

print("\n" + "-"*80)
print("\n[3] MERGED WORKFLOW ARGUMENTS (Result of deep_merge on variables):")
print(json.dumps(arguments_to_be_merged, indent=2))

print("\n" + "="*80)
print("ANALYSIS OF THE RESULT")
print("="*80)
print("""
The `deep_merge` function works as designed, but the structural mismatch
between the `execution_params` and the `workflow_variables` is now even clearer.

OBSERVATIONS:
1. FLAT vs. NESTED: The `execution_params` are a flat dictionary (e.g., 'height', 'weight').
   The `workflow_variables` expect these values inside nested objects (e.g., 'applicant', 'policy').

2. INCORRECT MERGE: As a result, the merge adds the new keys ('height', 'weight', etc.)
   to the top level of the `variables` dictionary instead of updating the intended
   nested values inside `variables.applicant` and `variables.policy`.

3. KEY MISMATCHES: Some keys do not align. For example, the frontend sent 'face_value'
   while the workflow expects 'face_amount' inside the 'policy' object. Similarly,
   the frontend sent 'date_of_birth' which corresponds to 'dob' in the 'applicant' object.

PROPOSED SOLUTION:
To fix this, the backend Python script (`workflow_executor.py`) needs a "translation" or
"mapping" step. Before merging, it should transform the flat `execution_params` into a
nested dictionary that matches the structure of `workflow_variables`.

Example of what the `execution_params` SHOULD look like before merging:
""")

# Example of correctly structured parameters for the deep_merge to work as intended.
correctly_structured_params = {
    "applicant": {
        "dob": "01/15/1985",
        "height": "5'10\"",
        "weight": "180",
        "zip_code": "90210"
        # etc.
    },
    "policy": {
        "face_amount": "250000"
    }
}
print(json.dumps(correctly_structured_params, indent=2))
print("") 