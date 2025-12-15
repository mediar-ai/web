'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Monitor,
  Cpu,
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Coins,
  CreditCard,
  Sparkles,
  Gift,
} from 'lucide-react';
import { toast } from 'sonner';
import { VM_SIZES, CREDIT_PACKAGES } from '@/lib/credits';
import { cn } from '@/lib/utils';
import { FreeCreditsEligibilityModal } from './FreeCreditsEligibilityModal';
import { usePostHog } from 'posthog-js/react';

interface LaunchVmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userCredits: number;
  onCreditsChange?: () => void;
}

type Step = 'config' | 'buy-credits' | 'provisioning' | 'success';

interface VmConfig {
  name: string;
  vmSize: string;
}

// User-friendly provisioning steps (simplified from technical backend steps)
const PROVISIONING_STEPS = [
  { key: 'prepare', label: 'Preparing environment', backendSteps: ['init', 'image', 'queued'] },
  { key: 'infrastructure', label: 'Setting up infrastructure', backendSteps: ['resource-group', 'resource_group', 'network', 'security', 'nsg'] },
  { key: 'network', label: 'Configuring network', backendSteps: ['public-ip', 'public_ip', 'nic'] },
  { key: 'launch', label: 'Launching sandbox', backendSteps: ['vm'] },
  { key: 'configure', label: 'Installing tools', backendSteps: ['configure', 'finalize'] },
  { key: 'ready', label: 'Ready!', backendSteps: ['done'] },
];

// Get which user-facing step we're on based on backend step
const getActiveStepIndex = (backendStep: string): number => {
  for (let i = 0; i < PROVISIONING_STEPS.length; i++) {
    if (PROVISIONING_STEPS[i].backendSteps.includes(backendStep)) {
      return i;
    }
  }
  return 0;
};

export function LaunchVmDialog({
  open,
  onOpenChange,
  userCredits,
  onCreditsChange,
}: LaunchVmDialogProps) {
  const posthog = usePostHog();
  const [step, setStep] = useState<Step>('config');
  const [config, setConfig] = useState<VmConfig>({
    name: '',
    vmSize: 'Standard_D4s_v3',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [_provisioningStatus, setProvisioningStatus] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<string>('init');
  const [machineId, setMachineId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFreeCreditsModal, setShowFreeCreditsModal] = useState(false);
  const provisioningStartTime = useRef<number>(0);
  // Track if dialog was previously open to detect fresh opens vs re-renders
  const wasOpenRef = useRef(false);

  const selectedSize = VM_SIZES.find(s => s.id === config.vmSize) || VM_SIZES[1];
  const canAfford = userCredits >= selectedSize.launchCost;

  // Reset state only when dialog freshly opens (not on userCredits changes)
  useEffect(() => {
    // Only reset when transitioning from closed to open
    if (open && !wasOpenRef.current) {
      posthog?.capture('sandbox_dialog_opened', {
        user_credits: userCredits,
        can_afford_default: userCredits >= VM_SIZES[1].launchCost,
      });
      setStep('config');
      setConfig({ name: '', vmSize: 'Standard_D4s_v3' });
      setError(null);
      setMachineId(null);
      setProvisioningStatus('');
      setCurrentStep('init');
    }
    wasOpenRef.current = open;
  }, [open, posthog, userCredits]);

  const handleLaunch = async () => {
    if (!config.name.trim()) {
      setError('Please enter a sandbox name');
      posthog?.capture('sandbox_launch_validation_error', { error: 'empty_name' });
      return;
    }

    if (!canAfford) {
      posthog?.capture('sandbox_insufficient_credits', {
        user_credits: userCredits,
        required_credits: selectedSize.launchCost,
        selected_size: config.vmSize,
      });
      setStep('buy-credits');
      return;
    }

    // Track launch attempt
    posthog?.capture('sandbox_launch_started', {
      sandbox_name: config.name,
      vm_size: config.vmSize,
      user_credits: userCredits,
      launch_cost: selectedSize.launchCost,
    });
    provisioningStartTime.current = Date.now();

    setIsLoading(true);
    setError(null);
    setStep('provisioning');
    setProvisioningStatus('Preparing your sandbox...');

    try {
      const response = await fetch('/api/vm/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.name,
          vmSize: config.vmSize,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create sandbox');
      }

      setMachineId(data.machine.id);
      setProvisioningStatus('Setting up your environment...');

      posthog?.capture('sandbox_provisioning_started', {
        machine_id: data.machine.id,
        sandbox_name: config.name,
        vm_size: config.vmSize,
      });

      // Poll for status updates
      pollProvisioningStatus(data.machine.id);

      toast.success(`Creating "${data.machine.name}"...`);
      onCreditsChange?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create sandbox';
      posthog?.capture('sandbox_launch_failed', {
        error: errorMessage,
        sandbox_name: config.name,
        vm_size: config.vmSize,
      });
      setError(errorMessage);
      setStep('config');
      toast.error('Failed to create sandbox');
    } finally {
      setIsLoading(false);
    }
  };

  const pollProvisioningStatus = async (id: number) => {
    const maxAttempts = 60; // 10 minutes at 10s intervals
    let attempts = 0;
    let lastTrackedStep = '';

    const poll = async () => {
      try {
        const response = await fetch(`/api/machines/${id}`);
        const data = await response.json();

        if (data.machine) {
          const provStep = data.machine.provisioning_step;
          if (provStep) {
            const parsed = typeof provStep === 'string' ? JSON.parse(provStep) : provStep;
            // Update current step for UI mapping
            if (parsed.step) {
              // Track step transitions
              if (parsed.step !== lastTrackedStep) {
                posthog?.capture('sandbox_provisioning_step', {
                  machine_id: id,
                  step: parsed.step,
                  step_index: getActiveStepIndex(parsed.step),
                  elapsed_seconds: Math.round((Date.now() - provisioningStartTime.current) / 1000),
                });
                lastTrackedStep = parsed.step;
              }
              setCurrentStep(parsed.step);
            }
            // Keep raw message for technical details
            setProvisioningStatus(parsed.message || '');

            if (parsed.step === 'done' || parsed.status === 'completed') {
              const totalTime = Math.round((Date.now() - provisioningStartTime.current) / 1000);
              posthog?.capture('sandbox_provisioning_completed', {
                machine_id: id,
                total_time_seconds: totalTime,
                sandbox_name: config.name,
                vm_size: config.vmSize,
              });
              setStep('success');
              onCreditsChange?.();
              return;
            }

            if (parsed.status === 'failed') {
              posthog?.capture('sandbox_provisioning_failed', {
                machine_id: id,
                error: parsed.message,
                failed_at_step: parsed.step,
                elapsed_seconds: Math.round((Date.now() - provisioningStartTime.current) / 1000),
              });
              setError(parsed.message || 'Provisioning failed');
              setStep('config');
              return;
            }
          }

          if (data.machine.status === 'active') {
            const totalTime = Math.round((Date.now() - provisioningStartTime.current) / 1000);
            posthog?.capture('sandbox_provisioning_completed', {
              machine_id: id,
              total_time_seconds: totalTime,
              sandbox_name: config.name,
              vm_size: config.vmSize,
            });
            setStep('success');
            onCreditsChange?.();
            return;
          }
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000); // Poll every 10 seconds
        } else {
          posthog?.capture('sandbox_provisioning_timeout', {
            machine_id: id,
            last_step: lastTrackedStep,
            elapsed_seconds: Math.round((Date.now() - provisioningStartTime.current) / 1000),
          });
        }
      } catch {
        // Continue polling on error
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000);
        }
      }
    };

    poll();
  };

  const handleBuyCredits = async (packageId: string) => {
    const selectedPackage = CREDIT_PACKAGES.find(p => p.id === packageId);
    posthog?.capture('sandbox_credits_checkout_started', {
      package_id: packageId,
      package_price: selectedPackage?.price,
      package_credits: selectedPackage?.credits,
      current_credits: userCredits,
    });

    setIsLoading(true);
    try {
      const response = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start checkout';
      posthog?.capture('sandbox_credits_checkout_failed', {
        package_id: packageId,
        error: errorMessage,
      });
      toast.error(errorMessage);
      setIsLoading(false);
    }
  };

  const handleFreeCreditsGranted = (amount: number) => {
    posthog?.capture('sandbox_free_credits_granted', {
      credits_amount: amount,
      previous_credits: userCredits,
    });
    // Refresh credits and go back to config step
    onCreditsChange?.();
    setStep('config');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        {step === 'config' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-xl">
                <Monitor className="h-5 w-5" />
                LAUNCH AGENT SANDBOX
              </DialogTitle>
              <DialogDescription>
                Your AI agent runs workflows in a secure cloud environment
                <span className="block text-xs text-gray-400 mt-1">Windows cloud machine with all tools pre-installed</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Sandbox Name */}
              <div className="space-y-2">
                <Label htmlFor="vm-name" className="font-mono text-xs uppercase">
                  Sandbox Name
                </Label>
                <Input
                  id="vm-name"
                  placeholder="my-automation"
                  value={config.name}
                  onChange={e => setConfig({ ...config, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="font-mono border-2 border-black"
                />
                <p className="text-xs text-gray-500">
                  Give it a name you&apos;ll recognize
                </p>
              </div>

              {/* Size Selection */}
              <div className="space-y-3">
                <Label className="font-mono text-xs uppercase">Performance</Label>
                <div className="grid gap-3">
                  {VM_SIZES.map(size => (
                    <button
                      key={size.id}
                      onClick={() => {
                        if (config.vmSize !== size.id) {
                          posthog?.capture('sandbox_size_selected', {
                            size_id: size.id,
                            size_name: size.name,
                            launch_cost: size.launchCost,
                            hourly_cost: size.perHourCost,
                          });
                        }
                        setConfig({ ...config, vmSize: size.id });
                      }}
                      className={cn(
                        'relative flex items-center justify-between p-4 border-2 transition-all text-left',
                        config.vmSize === size.id
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 hover:border-black'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Cpu className="h-5 w-5" />
                        <div>
                          <div className="font-mono font-bold">{size.name}</div>
                          <div className={cn(
                            'text-sm',
                            config.vmSize === size.id ? 'text-gray-300' : 'text-gray-500'
                          )}>
                            {size.specs}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold flex items-center gap-1">
                          <Coins className="h-4 w-4" />
                          {size.launchCost}
                        </div>
                        <div className={cn(
                          'text-xs',
                          config.vmSize === size.id ? 'text-gray-300' : 'text-gray-500'
                        )}>
                          + {size.perHourCost}/hr
                        </div>
                      </div>
                      {size.recommended && (
                        <span className={cn(
                          'absolute -top-2 -right-2 px-2 py-0.5 text-xs font-mono',
                          config.vmSize === size.id
                            ? 'bg-white text-black'
                            : 'bg-black text-white'
                        )}>
                          RECOMMENDED
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cost Summary */}
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-gray-600">Your Balance</span>
                  <span className="font-mono font-bold flex items-center gap-1">
                    <Coins className="h-4 w-4" />
                    {userCredits} credits
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm text-gray-600">Launch Cost</span>
                  <span className="font-mono font-bold flex items-center gap-1">
                    <Coins className="h-4 w-4" />
                    {selectedSize.launchCost} credits
                  </span>
                </div>
                <div className="border-t border-gray-300 pt-2 flex justify-between items-center">
                  <span className="font-mono text-sm font-bold">After Launch</span>
                  <span className={cn(
                    'font-mono font-bold',
                    canAfford ? 'text-black' : 'text-red-600'
                  )}>
                    {userCredits - selectedSize.launchCost} credits
                  </span>
                </div>
              </div>

              {/* Free credits hint for users with low balance */}
              {userCredits < 15 && (
                <button
                  onClick={() => {
                    posthog?.capture('sandbox_free_credits_clicked', {
                      source: 'config_hint',
                      current_credits: userCredits,
                    });
                    setShowFreeCreditsModal(true);
                  }}
                  className="w-full flex items-center justify-between p-3 border-2 border-dashed border-gray-300 hover:border-black transition-all text-left bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <Gift className="h-5 w-5" />
                    <span className="text-sm">Open source contributor?</span>
                  </div>
                  <span className="text-sm font-mono font-bold">Get 15 free credits →</span>
                </button>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="black-outline"
                onClick={() => {
                  posthog?.capture('sandbox_dialog_cancelled', {
                    step: 'config',
                    had_name: !!config.name.trim(),
                    selected_size: config.vmSize,
                  });
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              {canAfford ? (
                <Button
                  onClick={handleLaunch}
                  disabled={!config.name.trim() || isLoading}
                  className="bg-black text-white hover:bg-gray-800"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Launch Sandbox
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    posthog?.capture('sandbox_buy_credits_clicked', {
                      current_credits: userCredits,
                      required_credits: selectedSize.launchCost,
                    });
                    setStep('buy-credits');
                  }}
                  className="bg-black text-white hover:bg-gray-800"
                >
                  <CreditCard className="h-4 w-4" />
                  Buy Credits
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === 'buy-credits' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-xl">
                <Coins className="h-5 w-5" />
                GET CREDITS
              </DialogTitle>
              <DialogDescription>
                You need {selectedSize.launchCost - userCredits} more credits to launch this sandbox
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Free Credits Option */}
              <button
                onClick={() => {
                  posthog?.capture('sandbox_free_credits_clicked', {
                    source: 'buy_credits_screen',
                    current_credits: userCredits,
                  });
                  setShowFreeCreditsModal(true);
                }}
                disabled={isLoading}
                className="relative flex items-center justify-between p-4 border-2 border-dashed border-gray-400 hover:border-black transition-all text-left bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-black text-white rounded-full">
                    <Gift className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-mono font-bold text-lg">Free Credits</div>
                    <div className="text-sm text-gray-500">
                      For open source contributors
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-2xl font-bold text-black">FREE</div>
                  <div className="text-sm text-gray-500 flex items-center gap-1 justify-end">
                    <Coins className="h-3 w-3" />
                    15 credits
                  </div>
                </div>
              </button>

              <div className="relative flex items-center justify-center py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <span className="relative bg-white px-3 text-sm text-gray-500 font-mono">
                  OR BUY CREDITS
                </span>
              </div>

              {CREDIT_PACKAGES.map(pkg => (
                <button
                  key={pkg.id}
                  onClick={() => handleBuyCredits(pkg.id)}
                  disabled={isLoading}
                  className={cn(
                    'relative flex items-center justify-between p-4 border-2 transition-all text-left',
                    pkg.popular
                      ? 'border-black bg-black text-white'
                      : 'border-gray-200 hover:border-black'
                  )}
                >
                  <div>
                    <div className="font-mono font-bold text-lg">{pkg.name}</div>
                    <div className={cn(
                      'text-sm',
                      pkg.popular ? 'text-gray-300' : 'text-gray-500'
                    )}>
                      {pkg.description}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl font-bold">${pkg.price}</div>
                    <div className={cn(
                      'text-sm flex items-center gap-1 justify-end',
                      pkg.popular ? 'text-gray-300' : 'text-gray-500'
                    )}>
                      <Coins className="h-3 w-3" />
                      {pkg.credits} credits
                    </div>
                  </div>
                  {pkg.popular && (
                    <span className="absolute -top-2 -right-2 px-2 py-0.5 text-xs font-mono bg-white text-black flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      BEST VALUE
                    </span>
                  )}
                </button>
              ))}
            </div>

            <DialogFooter>
              <Button
                variant="black-outline"
                onClick={() => setStep('config')}
                disabled={isLoading}
              >
                Back
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'provisioning' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-xl">
                <Zap className="h-5 w-5" />
                CREATING SANDBOX
              </DialogTitle>
              <DialogDescription>
                <span className="font-mono font-bold">{config.name}</span> — usually takes 5-7 minutes
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-6">
              {/* Step list */}
              <div className="space-y-3">
                {PROVISIONING_STEPS.map((provStep, index) => {
                  const activeIndex = getActiveStepIndex(currentStep);
                  const isComplete = index < activeIndex;
                  const isActive = index === activeIndex;

                  return (
                    <div
                      key={provStep.key}
                      className={cn(
                        'flex items-center gap-3 p-3 border-2 transition-all',
                        isComplete ? 'border-black bg-black text-white' :
                        isActive ? 'border-black bg-gray-50' :
                        'border-gray-200 bg-gray-50 text-gray-400'
                      )}
                    >
                      {/* Step indicator */}
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                        isComplete ? 'bg-white text-black' :
                        isActive ? 'bg-black text-white' :
                        'bg-gray-200 text-gray-400'
                      )}>
                        {isComplete ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : isActive ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <span className="font-mono text-sm font-bold">{index + 1}</span>
                        )}
                      </div>

                      {/* Step label */}
                      <span className={cn(
                        'font-mono text-sm',
                        isActive && 'font-bold'
                      )}>
                        {provStep.label}
                      </span>

                      {/* Active indicator dot */}
                      {isActive && (
                        <span className="ml-auto h-2 w-2 rounded-full bg-black animate-pulse" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black transition-all duration-500"
                  style={{ width: `${((getActiveStepIndex(currentStep) + 1) / PROVISIONING_STEPS.length) * 100}%` }}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="black-outline"
                onClick={() => {
                  posthog?.capture('sandbox_dialog_closed_during_provisioning', {
                    current_step: currentStep,
                    step_index: getActiveStepIndex(currentStep),
                    elapsed_seconds: Math.round((Date.now() - provisioningStartTime.current) / 1000),
                    machine_id: machineId,
                  });
                  onOpenChange(false);
                }}
              >
                Close — continues in background
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'success' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-xl">
                <CheckCircle2 className="h-5 w-5" />
                SANDBOX READY
              </DialogTitle>
              <DialogDescription>
                Your agent sandbox is ready to run workflows
              </DialogDescription>
            </DialogHeader>

            <div className="py-8 flex flex-col items-center gap-4">
              <div className="w-24 h-24 border-4 border-black rounded-full flex items-center justify-center bg-gray-50">
                <CheckCircle2 className="h-12 w-12 text-black" />
              </div>
              <div className="text-center">
                <p className="font-mono font-bold text-lg">{config.name}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Ready to execute your automations
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="black-outline"
                onClick={() => {
                  posthog?.capture('sandbox_success_closed', {
                    machine_id: machineId,
                    viewed_sandbox: false,
                  });
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  posthog?.capture('sandbox_success_view_clicked', {
                    machine_id: machineId,
                  });
                  onOpenChange(false);
                  if (machineId) {
                    window.location.href = `/machines/${machineId}`;
                  }
                }}
                className="bg-black text-white hover:bg-gray-800"
              >
                View Sandbox
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {/* Free Credits Eligibility Modal */}
      <FreeCreditsEligibilityModal
        isOpen={showFreeCreditsModal}
        onOpenChange={setShowFreeCreditsModal}
        onCreditsGranted={handleFreeCreditsGranted}
      />
    </Dialog>
  );
}
