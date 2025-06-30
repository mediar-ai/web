-- Sample workflow data based on your insurance quote example
-- Run this after creating the deployed_workflows table

INSERT INTO public.deployed_workflows (
    name,
    description,
    automation_sequence,
    validation_checks,
    error_handling,
    input_parameters,
    expected_outputs,
    sample_inputs,
    estimated_duration_seconds,
    category,
    tags,
    difficulty_level,
    modal_function_name
) VALUES (
    'Best Plan Pro Insurance Quote',
    'Automated life insurance quote generation workflow that fills forms and retrieves quotes from Best Plan Pro platform',
    '{
        "name": "Best Plan Pro Insurance Quote",
        "url": "https://v2preview.online.bestplanpro.com/",
        "steps": [
            {
                "action": "navigate_browser",
                "url": "https://v2preview.online.bestplanpro.com/",
                "description": "Open Best Plan Pro website"
            },
            {
                "action": "click_element",
                "selector": "#12450054977295322368",
                "alternative_selectors": "name:Accept,role:Group >> name:Accept",
                "description": "Click Accept button on EULA dialog",
                "wait_for": "Dialog to disappear"
            },
            {
                "action": "type_into_element",
                "selector": "name:Date of Birth",
                "text": "{{date_of_birth}}",
                "clear_before": true,
                "description": "Enter date of birth"
            },
            {
                "action": "click_element",
                "selector": "name:{{sex}}",
                "description": "Select gender radio button"
            },
            {
                "action": "type_into_element",
                "selector": "name:Weight (lbs)",
                "text": "{{weight}}",
                "clear_before": true,
                "description": "Enter weight in pounds"
            },
            {
                "action": "click_element",
                "selector": "name:{{nicotine_usage}}",
                "description": "Select nicotine usage option"
            },
            {
                "action": "type_into_element",
                "selector": "name:State",
                "text": "{{state}}",
                "description": "Enter state"
            },
            {
                "action": "type_into_element",
                "selector": "name:Zip Code",
                "text": "{{zip_code}}",
                "clear_before": true,
                "description": "Enter zip code"
            },
            {
                "action": "type_into_element",
                "selector": "name:Face Value ($)",
                "text": "{{face_value}}",
                "clear_before": true,
                "description": "Enter coverage amount"
            },
            {
                "action": "click_element",
                "selector": "#9116875023776272252",
                "alternative_selectors": "name:Term",
                "description": "Select Term life insurance product"
            },
            {
                "action": "click_element",
                "selector": "#14493993113991611727",
                "alternative_selectors": "name:No",
                "description": "Select No for open enrollment"
            },
            {
                "action": "type_into_element",
                "selector": "#16783872191045950436",
                "alternative_selectors": "name:Height",
                "text": "{{height}}",
                "clear_before": true,
                "description": "Enter height - will trigger health wizard"
            },
            {
                "action": "click_element",
                "selector": "#16251652239921112986",
                "alternative_selectors": "name:Cancel",
                "description": "Cancel health wizard dialog",
                "wait_after": 500
            },
            {
                "action": "click_element",
                "selector": "#17517999067772859239",
                "alternative_selectors": "name:Run Quote",
                "description": "Click Run Quote button to generate quotes"
            },
            {
                "action": "wait_for_element",
                "selector": "name:Quote Results",
                "timeout": 60000,
                "description": "Wait for quote results to load (up to 60 seconds)"
            }
        ]
    }',
    '{
        "checks": [
            {
                "check": "EULA accepted",
                "selector": "!name:End-User License Agreement"
            },
            {
                "check": "Form filled",
                "required_fields": [
                    "Date of Birth: has value",
                    "Sex: Male selected",
                    "Weight: has value",
                    "Height: has value",
                    "State: has value",
                    "Zip Code: has value",
                    "Face Value: has value",
                    "Product Type: Term selected",
                    "Open Enrollment: No selected"
                ]
            },
            {
                "check": "Quote running",
                "selector": "name:Please wait..."
            },
            {
                "check": "Results displayed",
                "selector": "name:Quote Results"
            }
        ]
    }',
    '{
        "errors": [
            {
                "error": "EULA dialog blocks interaction",
                "retry": "Click Accept button again"
            },
            {
                "error": "Health wizard appears",
                "action": "Click Cancel button (#16251652239921112986)"
            },
            {
                "error": "Run Quote button disabled",
                "verify": "All required fields are filled"
            },
            {
                "error": "Quote takes too long",
                "wait": "Up to 60 seconds",
                "fallback": "Refresh and retry entire sequence"
            }
        ]
    }',
    '{
        "required": {
            "date_of_birth": {
                "type": "string",
                "format": "MM/DD/YYYY",
                "description": "Date of birth in MM/DD/YYYY format",
                "example": "01/15/1985"
            },
            "sex": {
                "type": "enum",
                "values": ["Male", "Female"],
                "description": "Gender selection"
            },
            "weight": {
                "type": "string",
                "description": "Weight in pounds",
                "example": "180"
            },
            "height": {
                "type": "string",
                "description": "Height in feet and inches",
                "example": "5'\''10\"\""
            },
            "state": {
                "type": "string",
                "description": "State name",
                "example": "California"
            },
            "zip_code": {
                "type": "string",
                "length": 5,
                "description": "5-digit zip code",
                "example": "90210"
            },
            "face_value": {
                "type": "string",
                "description": "Insurance coverage amount in dollars",
                "example": "250000"
            }
        },
        "optional": {
            "nicotine_usage": {
                "type": "enum",
                "values": ["Never", "Occasionally", "Regular"],
                "default": "Never",
                "description": "Nicotine usage frequency"
            }
        }
    }',
    '{
        "quote_results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "monthly_premium": {"type": "number"},
                    "coverage_amount": {"type": "number"},
                    "product_type": {"type": "string"}
                }
            },
            "description": "Array of insurance quotes from different companies"
        },
        "execution_time": {
            "type": "number",
            "unit": "seconds",
            "description": "Total execution time"
        },
        "screenshots": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Base64 encoded screenshots of key steps"
        },
        "form_data": {
            "type": "object",
            "description": "Final form data that was submitted"
        }
    }',
    '{
        "date_of_birth": "01/15/1985",
        "sex": "Male",
        "weight": "180",
        "height": "5'\''10\"\"",
        "state": "California",
        "zip_code": "90210",
        "face_value": "250000",
        "nicotine_usage": "Never"
    }',
    120,
    'insurance',
    ARRAY['insurance', 'quotes', 'life-insurance', 'automation', 'form-filling'],
    'medium',
    'execute_insurance_quote_workflow'
);
