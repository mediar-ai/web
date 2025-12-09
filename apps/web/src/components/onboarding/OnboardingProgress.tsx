'use client';

import { cn } from '@/lib/utils';

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

export function OnboardingProgress({
  currentStep,
  totalSteps,
  stepLabels,
}: OnboardingProgressProps) {
  return (
    <div className="flex items-center justify-center w-full py-4">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;

        return (
          <div key={stepNumber} className="flex items-center">
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono font-bold transition-all duration-300',
                  isActive && 'bg-black text-white ring-2 ring-black ring-offset-2',
                  isCompleted && 'bg-black text-white',
                  !isActive && !isCompleted && 'border-2 border-gray-300 text-gray-400'
                )}
              >
                {stepNumber}
              </div>
              <span
                className={cn(
                  'text-xs font-mono mt-1 whitespace-nowrap',
                  isActive && 'text-black font-bold',
                  isCompleted && 'text-black',
                  !isActive && !isCompleted && 'text-gray-400'
                )}
              >
                {stepLabels[index]}
              </span>
            </div>

            {/* Connector Line */}
            {index < totalSteps - 1 && (
              <div
                className={cn(
                  'w-16 h-0.5 mx-2',
                  isCompleted ? 'bg-black' : 'bg-gray-200'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
