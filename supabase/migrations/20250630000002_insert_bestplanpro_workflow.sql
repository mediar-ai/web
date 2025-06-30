-- Insert Best Plan Pro Insurance Quote Workflow
INSERT INTO deployed_workflows (
  name,
  description,
  category,
  tags,
  automation_sequence,
  input_parameters,
  expected_outputs,
  status,
  difficulty_level,
  estimated_duration_seconds,
  successful_runs,
  failed_runs,
  total_executions
) VALUES (
  'Best Plan Pro Insurance Quote',
  'Automated life insurance quote generation from Best Plan Pro website with form filling and quote extraction',
  'insurance',
  ARRAY['insurance', 'quotes', 'life_insurance', 'automation', 'form_filling'],
  '[
    {
      "action": "navigate",
      "url": "https://v2preview.online.bestplanpro.com/",
      "description": "Open Best Plan Pro website"
    },
    {
      "action": "click",
      "selector": "#12450054977295322368",
      "alternative_selectors": ["name:Accept", "role:Group >> name:Accept"],
      "description": "Click Accept button on EULA dialog",
      "wait_after": 1000
    },
    {
      "action": "fill_input",
      "selector": "name:Date of Birth",
      "value": "{{date_of_birth}}",
      "clear_before": true,
      "description": "Enter date of birth"
    },
    {
      "action": "click",
      "selector": "name:{{gender}}",
      "description": "Select gender radio button"
    },
    {
      "action": "fill_input",
      "selector": "name:Weight (lbs)",
      "value": "{{weight}}",
      "clear_before": true,
      "description": "Enter weight in pounds"
    },
    {
      "action": "click",
      "selector": "name:{{nicotine_usage}}",
      "description": "Select nicotine usage option"
    },
    {
      "action": "fill_input",
      "selector": "name:State",
      "value": "{{state}}",
      "description": "Enter state"
    },
    {
      "action": "fill_input",
      "selector": "name:Zip Code",
      "value": "{{zip_code}}",
      "clear_before": true,
      "description": "Enter zip code"
    },
    {
      "action": "fill_input",
      "selector": "name:Face Value ($)",
      "value": "{{face_value}}",
      "clear_before": true,
      "description": "Enter coverage amount"
    },
    {
      "action": "click",
      "selector": "#9116875023776272252",
      "alternative_selectors": ["name:Term"],
      "description": "Select Term life insurance product"
    },
    {
      "action": "click",
      "selector": "#14493993113991611727",
      "alternative_selectors": ["name:No"],
      "description": "Select No for open enrollment"
    },
    {
      "action": "fill_input",
      "selector": "#16783872191045950436",
      "alternative_selectors": ["name:Height"],
      "value": "{{height}}",
      "clear_before": true,
      "description": "Enter height - will trigger health wizard"
    },
    {
      "action": "click",
      "selector": "#16251652239921112986",
      "alternative_selectors": ["name:Cancel"],
      "description": "Cancel health wizard dialog",
      "wait_after": 500
    },
    {
      "action": "click",
      "selector": "#17517999067772859239",
      "alternative_selectors": ["name:Run Quote"],
      "description": "Click Run Quote button to generate quotes"
    },
    {
      "action": "wait_for_element",
      "selector": "name:Quote Results",
      "timeout": 60000,
      "description": "Wait for quote results to load (up to 60 seconds)"
    },
    {
      "action": "extract_data",
      "selector": "name:Quote Results",
      "data_key": "quote_results",
      "description": "Extract insurance quote results"
    }
  ]'::jsonb,
  '{
    "date_of_birth": {
      "type": "string",
      "required": true,
      "description": "Date of birth in MM/DD/YYYY format",
      "example": "01/15/1985"
    },
    "gender": {
      "type": "enum",
      "values": ["Male", "Female"],
      "required": true,
      "description": "Gender selection"
    },
    "weight": {
      "type": "string",
      "required": true,
      "description": "Weight in pounds",
      "example": "180"
    },
    "nicotine_usage": {
      "type": "enum",
      "values": ["Never", "Occasionally", "Regularly"],
      "required": true,
      "description": "Nicotine usage frequency"
    },
    "state": {
      "type": "string",
      "required": true,
      "description": "State name",
      "example": "California"
    },
    "zip_code": {
      "type": "string",
      "required": true,
      "description": "5-digit zip code",
      "example": "90210"
    },
    "face_value": {
      "type": "string",
      "required": true,
      "description": "Coverage amount in dollars",
      "example": "250000"
    },
    "height": {
      "type": "string",
      "required": true,
      "description": "Height in feet and inches",
      "example": "5''10\"\""
    }
  }'::jsonb,
  '{
    "quote_results": {
      "type": "array",
      "description": "Array of insurance quote results with carrier names, premiums, and coverage details"
    },
    "form_data": {
      "type": "object",
      "description": "Submitted form data for verification"
    },
    "execution_time": {
      "type": "number",
      "description": "Total execution time in seconds"
    }
  }'::jsonb,
  'active',
  'medium',
  90, -- estimated 90 seconds
  0,
  0,
  0
);
