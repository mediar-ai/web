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

// Fun loading messages aligned with Mediar brand
const PROVISIONING_MESSAGES = [
  { message: "Spinning up your sandbox...", sub: "This is the fun part" },
  { message: "Waking up the robots...", sub: "They had a good nap" },
  { message: "Teaching your agent new tricks...", sub: "It's a quick learner" },
  { message: "Connecting to the cloud...", sub: "No umbrella needed" },
  { message: "Installing automation superpowers...", sub: "With great power..." },
  { message: "Warming up the engines...", sub: "Almost ready for takeoff" },
  { message: "Brewing some digital coffee...", sub: "Your agent needs caffeine too" },
  { message: "Assembling the dream team...", sub: "Your workflows are in good hands" },
  { message: "Calibrating the automation matrix...", sub: "Sounds cooler than it is" },
  { message: "Deploying your personal assistant...", sub: "It doesn't need lunch breaks" },
];

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
  const [funMessage, setFunMessage] = useState(PROVISIONING_MESSAGES[0]);
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
      setFunMessage(PROVISIONING_MESSAGES[0]);
    }
  }, [open]);

  // Rotate fun messages during provisioning
  useEffect(() => {
    if (step === 'provisioning') {
      const interval = setInterval(() => {
        setFunMessage(prev => {
          const currentIndex = PROVISIONING_MESSAGES.findIndex(m => m.message === prev.message);
          const nextIndex = (currentIndex + 1) % PROVISIONING_MESSAGES.length;
          return PROVISIONING_MESSAGES[nextIndex];
        });
      }, 4000); // Change message every 4 seconds
      return () => clearInterval(interval);
    }
  }, [step]);

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
            setProvisioningStatus(parsed.message || `Step: ${parsed.step}`);

            if (parsed.step === 'done' || parsed.status === 'completed') {
              setStep('success');
              onCreditsChange?.();
              return;
            }

            if (parsed.status === 'failed') {
              setError(parsed.message || 'Provisioning failed');
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

            <div className="py-8 flex flex-col items-center gap-6">
              {/* Animated icon */}
              <div className="relative">
                <div className="w-28 h-28 border-4 border-black rounded-full flex items-center justify-center bg-gray-50">
                  <Monitor className="h-12 w-12" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-black text-white p-2 rounded-full">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
                {/* Decorative rings */}
                <div className="absolute inset-0 border-4 border-gray-200 rounded-full animate-ping opacity-20" />
              </div>

              {/* Sandbox name */}
              <div className="text-center">
                <p className="font-mono font-bold text-xl">{config.name}</p>
              </div>

              {/* Fun rotating message */}
              <div className="text-center min-h-[60px] flex flex-col justify-center">
                <p className="font-mono text-lg transition-all duration-300">{funMessage.message}</p>
                <p className="text-sm text-gray-400 mt-1 italic">{funMessage.sub}</p>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-sm">
                <div className="bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-black h-full transition-all duration-1000 ease-out"
                    style={{
                      width: '100%',
                      animation: 'progress 300s linear forwards'
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2 text-center font-mono">
                  {provisioningStatus || 'Initializing...'}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="black-outline"
                onClick={() => onOpenChange(false)}
              >
                Close — we'll keep working in the background
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
