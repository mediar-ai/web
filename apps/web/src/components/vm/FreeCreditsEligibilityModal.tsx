'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Loader2, ArrowLeft, Check, X, Gift } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';

interface FreeCreditsEligibilityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreditsGranted: (amount: number) => void;
}

interface FormData {
  isOpenSourceContributor: 'Yes' | 'No' | '';
  githubHandle: string;
  isWorkingOnBounty: 'Yes' | 'No' | '';
  bountyLink: string;
  needsWorkflowsForOthers: 'Yes' | 'No' | '';
  whatsappNumber: string;
  agreesToProvideFeedback: 'Yes' | 'No' | '';
  agreesToRaiseIssues: 'Yes' | 'No' | '';
  agreesToReportMissingFeatures: 'Yes' | 'No' | '';
  agreesToReportImprovements: 'Yes' | 'No' | '';
  agreesToTestNewFeatures: 'Yes' | 'No' | '';
  agreesToJoinWhatsAppChannel: 'Yes' | 'No' | '';
  fullName: string;
}

const TOTAL_STEPS = 12;
const STORAGE_KEY_FORM_DATA = 'freeCreditsFormData';
const STORAGE_KEY_CURRENT_STEP = 'freeCreditsCurrentStep';
const STORAGE_KEY_SUBMISSION_ID = 'freeCreditsSubmissionId';

// Validation patterns
const GITHUB_PATTERN = /^(https?:\/\/)?(www\.)?github\.com\/[\w-]+\/?$/i;
const URL_PATTERN = /^https?:\/\/.+\..+/i;
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

const QUESTIONS = [
  {
    id: 'isOpenSourceContributor',
    question: 'Are you an open source contributor?',
    type: 'yesno' as const,
    errorMessage: 'We offer free credits only to open source contributors.',
  },
  {
    id: 'githubHandle',
    question: "What's your GitHub profile URL?",
    type: 'text' as const,
    placeholder: 'e.g., github.com/username',
    errorMessage: 'Please provide your GitHub profile URL.',
    validation: GITHUB_PATTERN,
    validationError: 'Please enter a valid GitHub profile URL (e.g., github.com/username)',
  },
  {
    id: 'isWorkingOnBounty',
    question: 'Are you working on a bounty?',
    type: 'yesno' as const,
    hasTextField: true,
    textFieldId: 'bountyLink',
    textFieldPlaceholder: 'Link to the bounty (e.g., https://...)',
    textFieldLabel: 'Bounty link',
    textFieldValidation: URL_PATTERN,
    textFieldValidationError: 'Please enter a valid URL (e.g., https://github.com/org/repo/issues/123)',
    errorMessage: 'Free credits are available for bounty work.',
  },
  {
    id: 'needsWorkflowsForOthers',
    question: 'Do you need to create workflows for others?',
    type: 'yesno' as const,
    errorMessage: 'Free credits are for those building workflows for others.',
  },
  {
    id: 'whatsappNumber',
    question: "What's your WhatsApp number?",
    type: 'phone' as const,
    placeholder: '+1 234 567 8900',
    errorMessage: 'Please provide your WhatsApp number for communication.',
    validation: PHONE_PATTERN,
    validationError: 'International format required: + followed by country code and number (e.g., +1234567890)',
    hint: 'Include country code: +1 (US), +44 (UK), +91 (India), etc.',
  },
  {
    id: 'agreesToProvideFeedback',
    question: 'Do you agree to provide feedback about your VM usage?',
    type: 'yesno' as const,
    errorMessage: 'Free credits require commitment to provide feedback.',
  },
  {
    id: 'agreesToRaiseIssues',
    question: 'Do you agree to proactively raise issues/bugs?',
    type: 'yesno' as const,
    errorMessage: 'Free credits require commitment to report bugs.',
  },
  {
    id: 'agreesToReportMissingFeatures',
    question: 'Do you agree to tell us what things are missing?',
    type: 'yesno' as const,
    errorMessage: 'Free credits require commitment to report missing features.',
  },
  {
    id: 'agreesToReportImprovements',
    question: 'Do you agree to tell us what could be better?',
    type: 'yesno' as const,
    errorMessage: 'Free credits require commitment to suggest improvements.',
  },
  {
    id: 'agreesToTestNewFeatures',
    question: 'Do you agree to test new features if asked?',
    type: 'yesno' as const,
    errorMessage: 'Free credits require commitment to test new features.',
  },
  {
    id: 'agreesToJoinWhatsAppChannel',
    question: 'Do you agree to be added to the Mediar WhatsApp feedback channel?',
    type: 'yesno' as const,
    errorMessage: 'Free credits require joining the WhatsApp feedback channel.',
  },
  {
    id: 'fullName',
    question: "What's your name?",
    type: 'text' as const,
    placeholder: 'e.g., John Smith',
    errorMessage: 'Please provide your name.',
  },
];

export function FreeCreditsEligibilityModal({
  isOpen,
  onOpenChange,
  onCreditsGranted,
}: FreeCreditsEligibilityModalProps) {
  const posthog = usePostHog();

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    isOpenSourceContributor: '',
    githubHandle: '',
    isWorkingOnBounty: '',
    bountyLink: '',
    needsWorkflowsForOthers: '',
    whatsappNumber: '',
    agreesToProvideFeedback: '',
    agreesToRaiseIssues: '',
    agreesToReportMissingFeatures: '',
    agreesToReportImprovements: '',
    agreesToTestNewFeatures: '',
    agreesToJoinWhatsAppChannel: '',
    fullName: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    if (isOpen && !isInitialized) {
      try {
        const savedFormData = localStorage.getItem(STORAGE_KEY_FORM_DATA);
        const savedStep = localStorage.getItem(STORAGE_KEY_CURRENT_STEP);
        const savedSubmissionId = localStorage.getItem(STORAGE_KEY_SUBMISSION_ID);

        if (savedFormData) {
          setFormData(JSON.parse(savedFormData));
        }
        if (savedStep) {
          setCurrentStep(parseInt(savedStep, 10));
        }
        if (savedSubmissionId) {
          setSubmissionId(savedSubmissionId);
        } else {
          const newId = uuidv4();
          setSubmissionId(newId);
          localStorage.setItem(STORAGE_KEY_SUBMISSION_ID, newId);
        }

        setIsInitialized(true);
      } catch (err) {
        console.error('Error loading persisted survey data:', err);
        setIsInitialized(true);
      }
    }
  }, [isOpen, isInitialized]);

  // Persist form data changes
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(STORAGE_KEY_FORM_DATA, JSON.stringify(formData));
    }
  }, [formData, isInitialized]);

  // Persist current step
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(STORAGE_KEY_CURRENT_STEP, currentStep.toString());
    }
  }, [currentStep, isInitialized]);

  // Track partial completion
  const trackPartialCompletion = useCallback(
    (step: number, data: FormData) => {
      if (posthog) {
        posthog.capture('free_credits_partial_completion', {
          submission_id: submissionId,
          step_completed: step,
          total_steps: TOTAL_STEPS,
          form_data: data,
          timestamp: new Date().toISOString(),
        });
      }
    },
    [posthog, submissionId]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleRadioChange = (fieldName: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    setError(null);

    // Auto-advance after short delay for yes/no questions (if valid)
    setTimeout(() => {
      validateAndProceed(fieldName, value);
    }, 300);
  };

  const validateAndProceed = (fieldName?: keyof FormData, fieldValue?: string) => {
    const currentQuestion = QUESTIONS[currentStep];
    const updatedFormData = fieldName
      ? { ...formData, [fieldName]: fieldValue }
      : formData;

    setError(null);

    // Validate current step
    if (currentQuestion.type === 'yesno') {
      const value = updatedFormData[currentQuestion.id as keyof FormData];
      if (!value) {
        setError('Please select an option.');
        return false;
      }
      if (value === 'No') {
        setError(currentQuestion.errorMessage);
        return false;
      }
      // If Yes and has text field, validate it
      if (currentQuestion.hasTextField && currentQuestion.textFieldId) {
        const textValue = updatedFormData[currentQuestion.textFieldId as keyof FormData];
        if (!textValue || (typeof textValue === 'string' && !textValue.trim())) {
          setError(`Please provide the ${currentQuestion.textFieldLabel?.toLowerCase() || 'details'}.`);
          return false;
        }
        // Check pattern validation for text field if defined
        if ('textFieldValidation' in currentQuestion && currentQuestion.textFieldValidation && typeof textValue === 'string') {
          if (!currentQuestion.textFieldValidation.test(textValue.trim())) {
            setError(currentQuestion.textFieldValidationError || 'Invalid format');
            return false;
          }
        }
      }
    } else if (currentQuestion.type === 'text' || currentQuestion.type === 'phone') {
      const value = updatedFormData[currentQuestion.id as keyof FormData];
      if (!value || (typeof value === 'string' && !value.trim())) {
        setError(currentQuestion.errorMessage);
        return false;
      }
      // Check pattern validation if defined
      if ('validation' in currentQuestion && currentQuestion.validation && typeof value === 'string') {
        // Remove spaces, dashes, parentheses for phone validation
        const cleanValue = currentQuestion.type === 'phone' ? value.replace(/[\s\-()]/g, '') : value.trim();
        if (!currentQuestion.validation.test(cleanValue)) {
          setError(currentQuestion.validationError || 'Invalid format');
          return false;
        }
      }
    }

    // Track partial completion
    trackPartialCompletion(currentStep, updatedFormData);

    // Move to next step or submit
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleSubmit(updatedFormData);
    }

    return true;
  };

  const handleNext = () => {
    validateAndProceed();
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      setError(null);
    }
  };

  const handleSubmit = async (finalFormData: FormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/credits/free-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          formData: finalFormData,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit survey');
      }

      // Track completion
      if (posthog) {
        posthog.capture('free_credits_survey_completed', {
          submission_id: submissionId,
          credits_granted: data.creditsGranted,
          timestamp: new Date().toISOString(),
        });
      }

      // Clear localStorage
      localStorage.removeItem(STORAGE_KEY_FORM_DATA);
      localStorage.removeItem(STORAGE_KEY_CURRENT_STEP);
      localStorage.removeItem(STORAGE_KEY_SUBMISSION_ID);

      toast.success(`You've been granted ${data.creditsGranted} free credits!`);

      // Notify parent
      onCreditsGranted(data.creditsGranted);
      onOpenChange(false);
    } catch (err: unknown) {
      console.error('Survey submission error:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit survey. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    // Track abandonment if not completed
    if (posthog && currentStep < TOTAL_STEPS - 1) {
      posthog.capture('free_credits_survey_abandoned', {
        submission_id: submissionId,
        step_abandoned: currentStep,
        total_steps: TOTAL_STEPS,
        timestamp: new Date().toISOString(),
      });
    }
    onOpenChange(false);
  };

  const currentQuestion = QUESTIONS[currentStep];
  const progressPercent = ((currentStep + 1) / TOTAL_STEPS) * 100;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] border-2 border-black">
        <DialogHeader>
          <DialogTitle className="font-mono font-bold text-xl flex items-center gap-2">
            <Gift className="h-5 w-5" />
            FREE CREDITS FOR OSS CONTRIBUTORS
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Answer a few questions to receive 15 free credits (15 min workflow time).
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progressPercent} className="h-2" />
          <p className="text-xs text-gray-500 font-mono text-right">
            {currentStep + 1} / {TOTAL_STEPS}
          </p>
        </div>

        {/* Question content */}
        <div className="min-h-[200px] flex flex-col justify-center py-4">
          <h3 className="text-lg font-medium mb-6">{currentQuestion.question}</h3>

          {currentQuestion.type === 'yesno' ? (
            <div className="space-y-4">
              <RadioGroup
                value={formData[currentQuestion.id as keyof FormData] as string}
                onValueChange={(value) =>
                  handleRadioChange(currentQuestion.id as keyof FormData, value)
                }
                className="space-y-3"
              >
                <div className="flex items-center space-x-3 p-3 border-2 border-black rounded-lg hover:bg-gray-50 cursor-pointer">
                  <RadioGroupItem value="Yes" id={`${currentQuestion.id}-yes`} />
                  <Label
                    htmlFor={`${currentQuestion.id}-yes`}
                    className="flex-1 cursor-pointer font-normal flex items-center gap-2"
                  >
                    <Check className="w-4 h-4 text-black" />
                    Yes
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 border-2 border-black rounded-lg hover:bg-gray-50 cursor-pointer">
                  <RadioGroupItem value="No" id={`${currentQuestion.id}-no`} />
                  <Label
                    htmlFor={`${currentQuestion.id}-no`}
                    className="flex-1 cursor-pointer font-normal flex items-center gap-2"
                  >
                    <X className="w-4 h-4 text-black" />
                    No
                  </Label>
                </div>
              </RadioGroup>

              {/* Conditional text field for bounty link */}
              {currentQuestion.hasTextField &&
                formData[currentQuestion.id as keyof FormData] === 'Yes' && (
                  <div className="mt-4">
                    <Label
                      htmlFor={currentQuestion.textFieldId}
                      className="text-sm font-mono text-gray-600 mb-2 block"
                    >
                      {currentQuestion.textFieldLabel}
                    </Label>
                    <Input
                      id={currentQuestion.textFieldId}
                      name={currentQuestion.textFieldId}
                      value={
                        (formData[
                          currentQuestion.textFieldId as keyof FormData
                        ] as string) || ''
                      }
                      onChange={handleInputChange}
                      placeholder={currentQuestion.textFieldPlaceholder}
                      className="border-2 border-black font-mono"
                    />
                  </div>
                )}
            </div>
          ) : (
            <div>
              {currentQuestion.type === 'phone' && (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-300 rounded-lg">
                  <p className="text-sm font-mono text-gray-600">
                    {currentQuestion.hint}
                  </p>
                </div>
              )}
              <div className="relative">
                {currentQuestion.type === 'phone' && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-mono text-gray-400 pointer-events-none">
                    {!(formData[currentQuestion.id as keyof FormData] as string)?.startsWith('+') && '+'}
                  </span>
                )}
                <Input
                  id={currentQuestion.id}
                  name={currentQuestion.id}
                  type={currentQuestion.type === 'phone' ? 'tel' : 'text'}
                  value={(formData[currentQuestion.id as keyof FormData] as string) || ''}
                  onChange={handleInputChange}
                  placeholder={currentQuestion.placeholder}
                  className={`border-2 border-black font-mono ${currentQuestion.type === 'phone' ? 'text-lg tracking-wide' : ''}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleNext();
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-4 p-3 bg-gray-100 border-2 border-black rounded-lg">
              <p className="text-sm font-mono">{error}</p>
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex justify-between pt-4 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0 || isSubmitting}
            className="border-2 border-black hover:bg-black hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <Button
            onClick={handleNext}
            disabled={isSubmitting}
            className="bg-black text-white hover:bg-gray-800"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : currentStep === TOTAL_STEPS - 1 ? (
              'Submit'
            ) : (
              'Next'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
