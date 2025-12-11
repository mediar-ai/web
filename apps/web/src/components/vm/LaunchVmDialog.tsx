'use client';

import { useState, useEffect } from 'react';
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

// Map backend provisioning steps to user-friendly messages with fun subtitles
const STEP_MESSAGES: Record<string, { message: string; sub: string }> = {
  'init': { message: "Initializing...", sub: "Warming up the engines" },
  'image': { message: "Selecting the best image...", sub: "Only the finest for you" },
  'resource-group': { message: "Creating your workspace...", sub: "A place to call home" },
  'network': { message: "Setting up secure networking...", sub: "Building the highways" },
  'security': { message: "Configuring security rules...", sub: "Fort Knox mode activated" },
  'public-ip': { message: "Reserving your address...", sub: "Prime real estate" },
  'nic': { message: "Connecting the dots...", sub: "Almost there!" },
  'vm': { message: "Launching your sandbox...", sub: "The moment you've been waiting for" },
  'configure': { message: "Installing automation tools...", sub: "Loading the good stuff" },
  'finalize': { message: "Final touches...", sub: "Polishing everything up" },
  'done': { message: "Ready to go!", sub: "Your sandbox awaits" },
};

const DEFAULT_MESSAGE = { message: "Setting things up...", sub: "Good things take time" };

export function LaunchVmDialog({
  open,
  onOpenChange,
  userCredits,
  onCreditsChange,
}: LaunchVmDialogProps) {
  const [step, setStep] = useState<Step>('config');
  const [config, setConfig] = useState<VmConfig>({
    name: '',
    vmSize: 'Standard_D4s_v3',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [provisioningStatus, setProvisioningStatus] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<string>('init');
  const [machineId, setMachineId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFreeCreditsModal, setShowFreeCreditsModal] = useState(false);

  const selectedSize = VM_SIZES.find(s => s.id === config.vmSize) || VM_SIZES[1];
  const canAfford = userCredits >= selectedSize.launchCost;

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('config');
      setConfig({ name: '', vmSize: 'Standard_D4s_v3' });
      setError(null);
      setMachineId(null);
      setProvisioningStatus('');
      setCurrentStep('init');
    }
  }, [open]);

  const handleLaunch = async () => {
    if (!config.name.trim()) {
      setError('Please enter a sandbox name');
      return;
    }

    if (!canAfford) {
      setStep('buy-credits');
      return;
    }

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

      // Poll for status updates
      pollProvisioningStatus(data.machine.id);

      toast.success(`Creating "${data.machine.name}"...`);
      onCreditsChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sandbox');
      setStep('config');
      toast.error('Failed to create sandbox');
    } finally {
      setIsLoading(false);
    }
  };

  const pollProvisioningStatus = async (id: number) => {
    const maxAttempts = 60; // 10 minutes at 10s intervals
    let attempts = 0;

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
              setCurrentStep(parsed.step);
            }
            // Keep raw message for technical details
            setProvisioningStatus(parsed.message || '');

            if (parsed.step === 'done' || parsed.status === 'completed') {
              setStep('success');
              onCreditsChange?.();
              return;
            }

            if (parsed.status === 'failed') {
              setError(parsed.message || 'Provisioning failed');
              setStep('config');
              return;
            }
          }

          if (data.machine.status === 'active') {
            setStep('success');
            onCreditsChange?.();
            return;
          }
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000); // Poll every 10 seconds
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
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout');
      setIsLoading(false);
    }
  };

  const handleFreeCreditsGranted = (_amount: number) => {
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
                  Give it a name you'll recognize
                </p>
              </div>

              {/* Size Selection */}
              <div className="space-y-3">
                <Label className="font-mono text-xs uppercase">Performance</Label>
                <div className="grid gap-3">
                  {VM_SIZES.map(size => (
                    <button
                      key={size.id}
                      onClick={() => setConfig({ ...config, vmSize: size.id })}
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
                  onClick={() => setShowFreeCreditsModal(true)}
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
                onClick={() => onOpenChange(false)}
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
                  onClick={() => setStep('buy-credits')}
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
                onClick={() => setShowFreeCreditsModal(true)}
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
                Your agent environment will be ready in about 5 minutes
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 flex flex-col items-center gap-5">
              {/* Animated icon */}
              <div className="relative">
                <div className="w-24 h-24 border-4 border-black rounded-full flex items-center justify-center bg-gray-50">
                  <Monitor className="h-10 w-10" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-black text-white p-2 rounded-full">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>

              {/* Sandbox name */}
              <p className="font-mono font-bold text-lg">{config.name}</p>

              {/* Current step message from backend */}
              <div className="text-center">
                <p className="font-mono text-lg">
                  {STEP_MESSAGES[currentStep]?.message || DEFAULT_MESSAGE.message}
                </p>
                <p className="text-sm text-gray-400 mt-1 italic">
                  {STEP_MESSAGES[currentStep]?.sub || DEFAULT_MESSAGE.sub}
                </p>
              </div>

              {/* Technical status from backend */}
              {provisioningStatus && (
                <p className="text-xs text-gray-400 font-mono bg-gray-50 px-3 py-1 rounded">
                  {provisioningStatus}
                </p>
              )}

              {/* Progress indicator */}
              <div className="w-full max-w-xs">
                <div className="flex justify-center gap-1">
                  {Object.keys(STEP_MESSAGES).slice(0, -1).map((stepKey) => {
                    const stepIndex = Object.keys(STEP_MESSAGES).indexOf(stepKey);
                    const currentIndex = Object.keys(STEP_MESSAGES).indexOf(currentStep);
                    const isComplete = stepIndex < currentIndex;
                    const isCurrent = stepKey === currentStep;
                    return (
                      <div
                        key={stepKey}
                        className={cn(
                          'h-1.5 flex-1 rounded-full transition-all duration-300',
                          isComplete ? 'bg-black' : isCurrent ? 'bg-black animate-pulse' : 'bg-gray-200'
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="black-outline"
                onClick={() => onOpenChange(false)}
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
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
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
