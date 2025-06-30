const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://eshwntsgsputksqamckh.supabase.co';
const supabaseKey = '***REMOVED***';

const supabase = createClient(supabaseUrl, supabaseKey);

const automationSequence = {
  name: "Best Plan Pro Insurance Quote",
  url: "https://v2preview.online.bestplanpro.com/",
  steps: [
    {
      action: "navigate_browser",
      url: "https://v2preview.online.bestplanpro.com/",
      description: "Open Best Plan Pro website"
    },
    {
      action: "click_element",
      selector: "#12450054977295322368",
      alternative_selectors: "name:Accept,role:Group >> name:Accept",
      description: "Click Accept button on EULA dialog",
      wait_for: "Dialog to disappear"
    },
    {
      action: "type_into_element",
      selector: "name:Date of Birth",
      text: "01/15/1985",
      clear_before: true,
      description: "Enter date of birth"
    },
    {
      action: "click_element",
      selector: "name:Male",
      description: "Select Male radio button"
    },
    {
      action: "type_into_element",
      selector: "name:Weight (lbs)",
      text: "180",
      clear_before: true,
      description: "Enter weight in pounds"
    },
    {
      action: "click_element",
      selector: "name:Never",
      description: "Select Never for nicotine usage"
    },
    {
      action: "type_into_element",
      selector: "name:State",
      text: "California",
      description: "Enter state"
    },
    {
      action: "type_into_element",
      selector: "name:Zip Code",
      text: "90210",
      clear_before: true,
      description: "Enter zip code"
    },
    {
      action: "type_into_element",
      selector: "name:Face Value ($)",
      text: "250000",
      clear_before: true,
      description: "Enter coverage amount"
    },
    {
      action: "click_element",
      selector: "#9116875023776272252",
      alternative_selectors: "name:Term",
      description: "Select Term life insurance product"
    },
    {
      action: "click_element",
      selector: "#14493993113991611727",
      alternative_selectors: "name:No",
      description: "Select No for open enrollment"
    },
    {
      action: "type_into_element",
      selector: "#16783872191045950436",
      alternative_selectors: "name:Height",
      text: "5'10\"",
      clear_before: true,
      description: "Enter height - will trigger health wizard"
    },
    {
      action: "click_element",
      selector: "#16251652239921112986",
      alternative_selectors: "name:Cancel",
      description: "Cancel health wizard dialog",
      wait_after: 500
    },
    {
      action: "click_element",
      selector: "#17517999067772859239",
      alternative_selectors: "name:Run Quote",
      description: "Click Run Quote button to generate quotes"
    },
    {
      action: "wait_for_element",
      selector: "name:Quote Results",
      timeout: 60000,
      description: "Wait for quote results to load (up to 60 seconds)"
    }
  ]
};

const validationChecks = [
  {
    check: "EULA accepted",
    selector: "!name:End-User License Agreement"
  },
  {
    check: "Form filled",
    required_fields: [
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
    check: "Quote running",
    selector: "name:Please wait..."
  },
  {
    check: "Results displayed",
    selector: "name:Quote Results"
  }
];

const errorHandling = [
  {
    error: "EULA dialog blocks interaction",
    retry: "Click Accept button again"
  },
  {
    error: "Health wizard appears",
    action: "Click Cancel button (#16251652239921112986)"
  },
  {
    error: "Run Quote button disabled",
    verify: "All required fields are filled"
  },
  {
    error: "Quote takes too long",
    wait: "Up to 60 seconds",
    fallback: "Refresh and retry entire sequence"
  }
];

async function updateWorkflow() {
  try {
    const { data, error } = await supabase
      .from('deployed_workflows')
      .update({
        automation_sequence: automationSequence,
        validation_checks: validationChecks,
        error_handling: errorHandling,
        estimated_duration_seconds: 90
      })
      .eq('name', 'Best Plan Pro Workflow')
      .select();

    if (error) {
      console.error('Error updating workflow:', error);
    } else {
      console.log('Workflow updated successfully:', data);
    }
  } catch (err) {
    console.error('Script error:', err);
  }
}

updateWorkflow();
