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
import { Loader2, ArrowLeft, Check, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface FreeEligibilitySurveyModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSurveyComplete: () => void;
}

interface FormData {
  fullName: string;
  whatsappNumber: string;
  agreesToProvideFeedback: 'Yes' | 'No' | '';
  agreesToRaiseIssues: 'Yes' | 'No' | '';
}

const TOTAL_STEPS = 4;
const STORAGE_KEY_FORM_DATA = 'freeEligibilityFormData';
const STORAGE_KEY_CURRENT_STEP = 'freeEligibilityCurrentStep';
const STORAGE_KEY_SUBMISSION_ID = 'freeEligibilitySubmissionId';

// Validation patterns
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

const QUESTIONS = [
  {
    id: 'fullName',
    question: "What's your name?",
    type: 'text' as const,
    placeholder: 'e.g., John Smith',
    errorMessage: 'Please provide your name.',
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
    question: 'Do you agree to provide feedback about app usage?',
    type: 'yesno' as const,
    errorMessage: 'Free trial requires commitment to provide feedback.',
  },
  {
    id: 'agreesToRaiseIssues',
    question: 'Do you agree to proactively raise issues/bugs?',
    type: 'yesno' as const,
    errorMessage: 'Free trial requires commitment to report bugs.',
  },
];

export function FreeEligibilitySurveyModal({
  isOpen,
  onOpenChange,
  onSurveyComplete,
}: FreeEligibilitySurveyModalProps) {
  const posthog = usePostHog();

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    fullName: '',
    whatsappNumber: '',
    agreesToProvideFeedback: '',
    agreesToRaiseIssues: '',
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
        posthog.capture('free_eligibility_partial_completion', {
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
      const response = await fetch('/api/free-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          formData: finalFormData,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit survey');
      }

      // Track completion
      if (posthog) {
        posthog.capture('free_eligibility_survey_completed', {
          submission_id: submissionId,
          timestamp: new Date().toISOString(),
        });
      }

      // Clear localStorage
      localStorage.removeItem(STORAGE_KEY_FORM_DATA);
      localStorage.removeItem(STORAGE_KEY_CURRENT_STEP);
      localStorage.removeItem(STORAGE_KEY_SUBMISSION_ID);

      // Notify parent
      onSurveyComplete();
    } catch (err: any) {
      console.error('Survey submission error:', err);
      setError(err.message || 'Failed to submit survey. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    // Track abandonment if not completed
    if (posthog && currentStep < TOTAL_STEPS - 1) {
      posthog.capture('free_eligibility_survey_abandoned', {
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
          <DialogTitle className="font-mono font-bold text-xl">
            FREE TRIAL
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Answer a few quick questions to get started.
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
