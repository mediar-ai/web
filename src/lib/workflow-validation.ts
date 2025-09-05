/**
 * Workflow Output Parser Validation
 * Validates that workflows follow the standardized output format
 */

interface StandardizedOutput {
  success: boolean;
  data: any;
  message: string;
  error: string | null;
  validation: Record<string, any>;
}

/**
 * Validates if a JavaScript code string returns the standardized output format
 * @param code The JavaScript parser code to validate
 * @returns Validation result with warnings and errors
 */
export function validateOutputParserCode(code: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  hasStandardFormat: boolean;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check for return statement
  if (!code.includes('return')) {
    errors.push('Parser must have a return statement');
    return { isValid: false, errors, warnings, hasStandardFormat: false };
  }
  
  // Check for required fields in the return object
  const requiredFields = ['success', 'data', 'message', 'error', 'validation'];
  const missingFields: string[] = [];
  
  for (const field of requiredFields) {
    // Look for field in return object (basic regex check)
    const fieldPattern = new RegExp(`${field}\\s*:`);
    if (!fieldPattern.test(code)) {
      missingFields.push(field);
    }
  }
  
  // Determine if it follows standard format
  const hasStandardFormat = missingFields.length === 0;
  
  if (missingFields.length > 0) {
    warnings.push(
      `Parser may not follow standardized format. Missing fields: ${missingFields.join(', ')}. ` +
      'Standardized parsers should return: { success, data, message, error, validation }'
    );
  }
  
  // Check for common patterns that indicate old format (returning quotes directly)
  if (code.includes('return quotes') || code.includes('return extractedQuotes')) {
    warnings.push(
      'Parser appears to return quotes directly. Consider using standardized format: ' +
      '{ success: true, data: { quotes }, message: "...", error: null, validation: {...} }'
    );
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    hasStandardFormat
  };
}

/**
 * Extracts and validates output parser from YAML workflow
 * @param yamlContent The YAML content of the workflow
 * @returns Validation result
 */
export function validateWorkflowOutputParser(yamlContent: string): {
  hasParser: boolean;
  parserValidation?: ReturnType<typeof validateOutputParserCode>;
  isBackwardCompatible: boolean;
} {
  try {
    // Check if workflow has output_parser defined
    const hasOutputParser = yamlContent.includes('output_parser:');
    
    if (!hasOutputParser) {
      return { 
        hasParser: false, 
        isBackwardCompatible: true // Old workflows without parsers are still supported
      };
    }
    
    // Extract parser code (simplified extraction)
    const parserMatch = yamlContent.match(/javascript_code:\s*\|\s*([\s\S]*?)(?=\n\s*\w+:|$)/);
    
    if (!parserMatch) {
      return { 
        hasParser: true,
        parserValidation: {
          isValid: false,
          errors: ['Could not extract parser code from YAML'],
          warnings: [],
          hasStandardFormat: false
        },
        isBackwardCompatible: false
      };
    }
    
    const parserCode = parserMatch[1];
    const validation = validateOutputParserCode(parserCode);
    
    return {
      hasParser: true,
      parserValidation: validation,
      isBackwardCompatible: true // System handles both old and new formats
    };
  } catch (error) {
    return {
      hasParser: false,
      parserValidation: {
        isValid: false,
        errors: [`Failed to parse workflow: ${error}`],
        warnings: [],
        hasStandardFormat: false
      },
      isBackwardCompatible: false
    };
  }
}

/**
 * Creates a standardized parser template for common use cases
 */
export function createStandardizedParser(type: 'quotes' | 'form' | 'navigation' | 'generic'): string {
  const templates = {
    quotes: `// =============================================================================
// STANDARDIZED OUTPUT PARSER - Insurance Quote Extraction
// =============================================================================

// Extract quotes from the page
const quotes = [];
// ... quote extraction logic ...

// Validation checks
const validation = {
  pageLoaded: !!tree,
  quotesFound: quotes.length > 0,
  validQuoteFormat: quotes.every(q => q.premium && q.provider)
};

const success = validation.pageLoaded && validation.quotesFound;

return {
  success: success,
  data: {
    quotes: quotes,
    quoteCount: quotes.length,
    extractedAt: new Date().toISOString()
  },
  message: success 
    ? \`Successfully extracted \${quotes.length} quote(s)\`
    : "No quotes found or extraction failed",
  error: !validation.pageLoaded ? "Page failed to load" : null,
  validation: validation
};`,

    form: `// =============================================================================
// STANDARDIZED OUTPUT PARSER - Form Submission
// =============================================================================

// Check for submission confirmation
const hasSuccessMessage = tree?.text?.includes("success") || 
                         tree?.text?.includes("submitted");
const hasError = tree?.text?.includes("error") || 
                tree?.text?.includes("failed");

// Extract confirmation details
const confirmationNumber = tree?.text?.match(/[A-Z0-9]{6,}/)?.[0] || null;

// Validation checks
const validation = {
  formNavigated: !!tree,
  formSubmitted: true,
  successMessageFound: hasSuccessMessage,
  noErrors: !hasError,
  confirmationPresent: !!confirmationNumber
};

const success = validation.formNavigated && 
               validation.successMessageFound && 
               validation.noErrors;

return {
  success: success,
  data: {
    confirmationNumber: confirmationNumber,
    submittedAt: new Date().toISOString()
  },
  message: success 
    ? \`Form submitted successfully\${confirmationNumber ? ' - Confirmation: ' + confirmationNumber : ''}\`
    : "Form submission failed or could not be confirmed",
  error: hasError ? "Form submission error detected" : null,
  validation: validation
};`,

    navigation: `// =============================================================================
// STANDARDIZED OUTPUT PARSER - Page Navigation
// =============================================================================

// Extract page information
const pageTitle = tree?.attributes?.name || "";
const currentUrl = tree?.attributes?.description || "";

// Check for navigation errors
const hasError = tree?.attributes?.name?.includes("error") ||
                tree?.attributes?.name?.includes("404");

// Validation checks
const validation = {
  navigated: !!tree,
  titlePresent: pageTitle.length > 0,
  urlPresent: currentUrl.length > 0,
  noErrors: !hasError
};

const success = validation.navigated && validation.noErrors;

return {
  success: success,
  data: {
    pageTitle: pageTitle,
    currentUrl: currentUrl,
    navigationTime: new Date().toISOString()
  },
  message: success 
    ? \`Successfully navigated to \${currentUrl}\`
    : "Navigation failed or page not found",
  error: hasError ? "Navigation error detected" : null,
  validation: validation
};`,

    generic: `// =============================================================================
// STANDARDIZED OUTPUT PARSER - Generic Workflow
// =============================================================================

// Extract relevant data from the execution
const extractedData = {
  // Add your data extraction logic here
};

// Perform validation checks
const validation = {
  executionCompleted: true,
  dataExtracted: Object.keys(extractedData).length > 0,
  noErrors: true // Update based on actual error checking
};

const success = validation.executionCompleted && 
               validation.dataExtracted && 
               validation.noErrors;

return {
  success: success,
  data: extractedData,
  message: success 
    ? "Workflow executed successfully"
    : "Workflow execution failed or incomplete",
  error: null, // Update if errors detected
  validation: validation
};`
  };
  
  return templates[type];
}
