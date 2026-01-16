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
  Maximize2,
  X,
  Radio,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { VM_SIZES, CREDIT_PACKAGES } from '@/lib/credits';
import { cn } from '@/lib/utils';
import { FreeCreditsEligibilityModal } from './FreeCreditsEligibilityModal';
import { usePostHog } from 'posthog-js/react';
import { VNC_GATEWAY_URL } from '@/lib/azure';

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
  isTrial: boolean;
}

// Trial sandbox configuration
const TRIAL_CONFIG = {
  vmSize: 'Standard_D2s_v3', // Smallest size for trials
  launchCost: 0, // Free to launch
  autoStopMinutes: 30, // Auto-stop after 30 min idle
  autoDeleteDays: 1, // Delete after 1 day of non-usage
};

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
    isTrial: true, // Trial selected by default
  });
  const [isLoading, setIsLoading] = useState(false);
  const [_provisioningStatus, setProvisioningStatus] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<string>('init');
  const [machineId, setMachineId] = useState<number | null>(null);
  const [_requestId, setRequestId] = useState<string | null>(null);
  const [terraformKey, setTerraformKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFreeCreditsModal, setShowFreeCreditsModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const provisioningStartTime = useRef<number>(0);
  // Track if dialog was previously open to detect fresh opens vs re-renders
  const wasOpenRef = useRef(false);

  const selectedSize = VM_SIZES.find(s => s.id === config.vmSize) || VM_SIZES[1];
  // Trial sandboxes are free, otherwise check normal cost
  const effectiveLaunchCost = config.isTrial ? TRIAL_CONFIG.launchCost : selectedSize.launchCost;
  const canAfford = userCredits >= effectiveLaunchCost;

  // Reset state only when dialog freshly opens (not on userCredits changes)
  useEffect(() => {
    // Only reset when transitioning from closed to open
    if (open && !wasOpenRef.current) {
      posthog?.capture('sandbox_dialog_opened', {
        user_credits: userCredits,
        can_afford_default: userCredits >= VM_SIZES[1].launchCost,
      });
      setStep('config');
      setConfig({ name: '', vmSize: 'Standard_D4s_v3', isTrial: true });
      setError(null);
      setMachineId(null);
      setRequestId(null);
      setTerraformKey(null);
      setIsFullscreen(false);
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

    // For trial, use the trial VM size
    const vmSizeToUse = config.isTrial ? TRIAL_CONFIG.vmSize : config.vmSize;

    // Track launch attempt
    posthog?.capture('sandbox_launch_started', {
      sandbox_name: config.name,
      vm_size: vmSizeToUse,
      is_trial: config.isTrial,
      user_credits: userCredits,
      launch_cost: effectiveLaunchCost,
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
          vmSize: vmSizeToUse,
          isTrial: config.isTrial,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Show the most informative error message available
        const errorMsg = data.error || data.details || 'Failed to create sandbox';
        throw new Error(errorMsg);
      }

      // New Inngest-first approach: API returns requestId, not machineId
      // The DB record will be created by Inngest as step 1
      setRequestId(data.requestId);
      setProvisioningStatus('Setting up your environment...');

      posthog?.capture('sandbox_provisioning_started', {
        request_id: data.requestId,
        sandbox_name: config.name,
        vm_size: config.vmSize,
        is_trial: config.isTrial,
      });

      // Poll for status updates using requestId
      pollProvisioningStatusByRequestId(data.requestId);

      toast.success(`Creating "${data.vmName}"...`);
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

  // Poll provisioning status using requestId (Inngest-first approach)
  const pollProvisioningStatusByRequestId = async (reqId: string) => {
    const maxAttempts = 360; // 30 minutes at 5s intervals (Azure RunCommand can take 10-25 min)
    let attempts = 0;
    let lastTrackedStep = '';

    const poll = async () => {
      try {
        const response = await fetch(`/api/vm/provision/status?requestId=${reqId}`);
        const data = await response.json();

        // Update machineId once we get it from the status endpoint
        if (data.machineId && !machineId) {
          setMachineId(data.machineId);
        }

        // Handle different statuses
        if (data.status === 'pending') {
          // Inngest hasn't created the DB record yet, show queued state
          if (currentStep !== 'queued') {
            setCurrentStep('queued');
            setProvisioningStatus('Queued, waiting for provisioning to start...');
          }
        } else if (data.provisioningStep) {
          const parsed = data.provisioningStep;
          // Update current step for UI mapping
          if (parsed.step) {
            // Track step transitions
            if (parsed.step !== lastTrackedStep) {
              posthog?.capture('sandbox_provisioning_step', {
                request_id: reqId,
                machine_id: data.machineId,
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
        }

        // Check for completion
        if (data.status === 'complete') {
          const totalTime = Math.round((Date.now() - provisioningStartTime.current) / 1000);
          posthog?.capture('sandbox_provisioning_completed', {
            request_id: reqId,
            machine_id: data.machineId,
            total_time_seconds: totalTime,
            sandbox_name: config.name,
            vm_size: config.vmSize,
          });

          // Fetch machine details to get terraform_key for VNC
          if (data.machineId) {
            try {
              const machineResp = await fetch(`/api/machines/${data.machineId}`);
              const machineData = await machineResp.json();
              if (machineData.machine) {
                const machine = machineData.machine;
                // Extract terraform key from tags or terraform_key field
                const tagKey = machine.tags
                  ?.find((t: string) => t.startsWith('terraform:'))
                  ?.replace('terraform:', '');
                const tfKey = machine.terraform_key && !machine.terraform_key.startsWith('dashboard-')
                  ? machine.terraform_key
                  : null;
                setTerraformKey(tagKey || tfKey);
              }
            } catch (err) {
              console.error('Failed to fetch machine details for VNC:', err);
            }
          }
          setStep('success');
          onCreditsChange?.();
          return;
        }

        // Check for failure
        if (data.status === 'failed') {
          posthog?.capture('sandbox_provisioning_failed', {
            request_id: reqId,
            machine_id: data.machineId,
            error: data.provisioningStep?.message,
            failed_at_step: data.provisioningStep?.step,
            elapsed_seconds: Math.round((Date.now() - provisioningStartTime.current) / 1000),
          });
          setError(data.provisioningStep?.message || 'Provisioning failed');
          setStep('config');
          return;
        }

        // Continue polling
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // Poll every 5 seconds (faster since Inngest-first may have delay)
        } else {
          posthog?.capture('sandbox_provisioning_timeout', {
            request_id: reqId,
            machine_id: data.machineId,
            last_step: lastTrackedStep,
            elapsed_seconds: Math.round((Date.now() - provisioningStartTime.current) / 1000),
          });
        }
      } catch {
        // Continue polling on error
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
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
              {/* Trial vs Full Sandbox Toggle */}
              <div className="space-y-3">
                <Label className="font-mono text-xs uppercase">Sandbox Type</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      posthog?.capture('sandbox_type_selected', { type: 'trial' });
                      setConfig({ ...config, isTrial: true });
                    }}
                    className={cn(
                      'relative flex flex-col items-center justify-center p-4 border-2 transition-all',
                      config.isTrial
                        ? 'border-black bg-black text-white'
                        : 'border-gray-200 hover:border-black'
                    )}
                  >
                    <Clock className="h-6 w-6 mb-2" />
                    <span className="font-mono font-bold">TRIAL</span>
                    <span className={cn(
                      'text-xs mt-1',
                      config.isTrial ? 'text-gray-300' : 'text-gray-500'
                    )}>
                      Free • 30 min
                    </span>
                    <span className="absolute -top-2 -right-2 px-2 py-0.5 text-xs font-mono bg-green-500 text-white">
                      FREE
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      posthog?.capture('sandbox_type_selected', { type: 'full' });
                      setConfig({ ...config, isTrial: false });
                    }}
                    className={cn(
                      'relative flex flex-col items-center justify-center p-4 border-2 transition-all',
                      !config.isTrial
                        ? 'border-black bg-black text-white'
                        : 'border-gray-200 hover:border-black'
                    )}
                  >
                    <Monitor className="h-6 w-6 mb-2" />
                    <span className="font-mono font-bold">FULL</span>
                    <span className={cn(
                      'text-xs mt-1',
                      !config.isTrial ? 'text-gray-300' : 'text-gray-500'
                    )}>
                      Persistent • No limits
                    </span>
                  </button>
                </div>
                {config.isTrial && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Trial sandboxes auto-stop after 30 min idle and are deleted after 1 day
                  </p>
                )}
              </div>

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

              {/* Size Selection - only show for full sandboxes */}
              {!config.isTrial && (
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
              )}

              {/* Cost Summary - simplified for trial */}
              {config.isTrial ? (
                <div className="bg-green-50 border-2 border-green-200 p-4 text-center">
                  <span className="font-mono font-bold text-green-700">FREE TRIAL</span>
                  <p className="text-xs text-gray-600 mt-1">No credits required. Start exploring now!</p>
                </div>
              ) : (
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
              )}

              {/* Free credits hint for users with low balance - hide for trial */}
              {!config.isTrial && userCredits < 15 && (
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
                  window.location.href = '/my-machines';
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
                <Monitor className="h-5 w-5" />
                <span className="font-mono font-bold uppercase">{config.name}</span>
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs text-gray-500 font-normal">LIVE</span>
                </div>
              </DialogTitle>
              <DialogDescription>
                Your sandbox is ready. Use it directly from here or go fullscreen.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2">
              {/* VNC Viewer */}
              <div className="relative border-2 border-black bg-gray-900 rounded-lg overflow-hidden" style={{ height: '400px' }}>
                {terraformKey ? (
                  <>
                    {/* Fullscreen button */}
                    <button
                      onClick={() => {
                        posthog?.capture('sandbox_fullscreen_clicked', {
                          machine_id: machineId,
                        });
                        setIsFullscreen(true);
                      }}
                      className="absolute top-2 right-2 z-10 p-1.5 bg-black/80 text-white hover:bg-black transition-colors rounded"
                      title="Fullscreen"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    {/* VNC iframe */}
                    <iframe
                      src={`${VNC_GATEWAY_URL}/vnc/${terraformKey}`}
                      className="w-full h-full border-0"
                      allow="clipboard-read; clipboard-write"
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin mb-2" />
                    <span className="text-sm font-mono">Connecting to screen...</span>
                  </div>
                )}
              </div>

              {/* Read-only indicator */}
              <div className="flex items-center justify-center gap-2 mt-2 text-xs text-gray-500 font-mono">
                <Radio className="w-3 h-3" />
                <span>INTERACTIVE — Click inside to control</span>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="black-outline"
                onClick={() => {
                  posthog?.capture('sandbox_success_closed', {
                    machine_id: machineId,
                    viewed_sandbox: true,
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
                  window.open(`/my-machines`, '_blank');
                }}
                className="bg-black text-white hover:bg-gray-800"
              >
                Manage Sandboxes
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

      {/* Fullscreen VNC Modal */}
      {isFullscreen && terraformKey && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-gray-800">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                <h3 className="font-mono font-bold text-sm uppercase">
                  {config.name}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
                <Radio className="w-3 h-3" />
                <span>INTERACTIVE</span>
              </div>
              <button
                onClick={() => setIsFullscreen(false)}
                className="p-2 hover:bg-gray-800 rounded transition-colors"
                title="Exit fullscreen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          {/* VNC viewer */}
          <div className="flex-1">
            <iframe
              src={`${VNC_GATEWAY_URL}/vnc/${terraformKey}`}
              className="w-full h-full border-0"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
