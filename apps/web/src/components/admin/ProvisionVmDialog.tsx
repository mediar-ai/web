'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Server, DollarSign, AlertTriangle, Check, Loader2, Search, Building2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ProvisionOptions {
  vmSizes: { id: string; name: string; monthlyCost: number }[];
  regions: { id: string; name: string }[];
  defaultVmSize: string;
  defaultRegion: string;
  defaultOrganizationId: string;
}

interface Organization {
  id: string;
  name: string;
}

interface ProvisionVmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ProvisioningStep {
  step: string;
  status: 'in_progress' | 'completed' | 'failed';
  message: string;
  timestamp: string;
}

// Map Inngest step names to UI labels (in order)
const STEP_CONFIG: Record<string, { label: string; order: number }> = {
  queued: { label: 'Queued for provisioning', order: 0 },
  init: { label: 'Starting provisioning job', order: 1 },
  image: { label: 'Finding latest Packer image', order: 2 },
  resource_group: { label: 'Creating Azure resource group', order: 3 },
  network: { label: 'Setting up virtual network', order: 4 },
  public_ip: { label: 'Allocating public IP address', order: 5 },
  nsg: { label: 'Configuring network security', order: 6 },
  nic: { label: 'Creating network interface', order: 7 },
  vm: { label: 'Creating Windows VM', order: 8 },
  configure: { label: 'Configuring VM & starting MCP', order: 9 },
  finalize: { label: 'Finalizing setup', order: 10 },
  done: { label: 'VM Ready!', order: 11 },
};

const ORDERED_STEPS = Object.entries(STEP_CONFIG)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key, value]) => ({ key, ...value }));

const TOTAL_STEPS = ORDERED_STEPS.length;

export function ProvisionVmDialog({ isOpen, onClose, onSuccess }: ProvisionVmDialogProps) {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<ProvisionOptions | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioningComplete, setProvisioningComplete] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Progress tracking - now from real DB data
  const [currentProvisioningStep, setCurrentProvisioningStep] = useState<ProvisioningStep | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const [formData, setFormData] = useState({
    name: '',
    vmSize: 'Standard_D4s_v3',
    location: 'eastus',
    organizationId: '',
  });

  const [costEstimate, setCostEstimate] = useState<{
    monthly: number;
    breakdown: { item: string; cost: number }[];
  } | null>(null);

  // Get current step order from real data
  const currentStepOrder = useMemo(() => {
    if (!currentProvisioningStep) return 0;
    return STEP_CONFIG[currentProvisioningStep.step]?.order ?? 0;
  }, [currentProvisioningStep]);

  // Calculate progress percentage from actual step
  const progressPercent = useMemo(() => {
    if (provisioningComplete) return 100;
    const baseProgress = (currentStepOrder / TOTAL_STEPS) * 100;
    const inProgressBonus = currentProvisioningStep?.status === 'in_progress' ? 2 : 0;
    return Math.min(95, baseProgress + inProgressBonus);
  }, [currentStepOrder, provisioningComplete, currentProvisioningStep]);

  // Start elapsed time counter
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedSeconds(0);
    timerIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);
  }, []);

  // Stop timer
  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Fetch provisioning options when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchOptions();
    } else {
      // Reset state when dialog closes
      setProvisioning(false);
      setProvisioningComplete(false);
      setSearchTerm('');
      setCurrentProvisioningStep(null);
      setCompletedSteps(new Set());
      setElapsedSeconds(0);
      stopTimer();
    }
  }, [isOpen, stopTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const fetchOptions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/machines/provision');
      if (res.ok) {
        const data = await res.json();
        setOptions(data.options);
        setOrganizations(data.organizations || []);
        setCostEstimate(data.costEstimate);
        setFormData(prev => ({
          ...prev,
          vmSize: data.options.defaultVmSize,
          location: data.options.defaultRegion,
          organizationId: data.options.defaultOrganizationId,
        }));
      } else {
        toast.error('Failed to load provisioning options');
        onClose();
      }
    } catch {
      toast.error('Failed to load provisioning options');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleVmSizeChange = (vmSize: string) => {
    setFormData(prev => ({ ...prev, vmSize }));
    const selectedSize = options?.vmSizes.find(s => s.id === vmSize);
    if (selectedSize) {
      setCostEstimate({
        monthly: selectedSize.monthlyCost + 24, // VM + disk + IP
        breakdown: [
          { item: `VM (${vmSize})`, cost: selectedSize.monthlyCost },
          { item: 'OS Disk (128GB Premium SSD)', cost: 20 },
          { item: 'Public IP', cost: 4 },
        ],
      });
    }
  };

  // Poll for machine status - now reads real provisioning_step from DB
  const pollMachineStatus = useCallback(async (machineId: number) => {
    const pollInterval = 3000; // 3 seconds for more responsive UI
    const maxPollTime = 15 * 60 * 1000; // 15 minutes max
    const startTime = Date.now();

    const poll = async () => {
      if (Date.now() - startTime > maxPollTime) {
        stopTimer();
        toast.error('Provisioning is taking too long. Check the machines list for status.');
        setProvisioning(false);
        return;
      }

      try {
        // Fetch machine status from the machines API
        const res = await fetch('/api/machines?status=all&show_all=true');
        if (!res.ok) {
          setTimeout(poll, pollInterval);
          return;
        }

        const data = await res.json();
        const machine = data.machines?.find((m: { id: number }) => m.id === machineId);

        if (!machine) {
          setTimeout(poll, pollInterval);
          return;
        }

        // Parse provisioning_step from DB
        if (machine.provisioning_step) {
          let stepData: ProvisioningStep;
          if (typeof machine.provisioning_step === 'string') {
            stepData = JSON.parse(machine.provisioning_step);
          } else {
            stepData = machine.provisioning_step;
          }

          setCurrentProvisioningStep(stepData);

          // Track completed steps - mark all steps before current as completed
          const currentOrder = STEP_CONFIG[stepData.step]?.order ?? 0;
          const newCompleted = new Set<string>();
          for (const [key, config] of Object.entries(STEP_CONFIG)) {
            if (config.order < currentOrder) {
              newCompleted.add(key);
            }
            // Also mark current step as completed if its status is 'completed'
            if (key === stepData.step && stepData.status === 'completed') {
              newCompleted.add(key);
            }
          }
          setCompletedSteps(newCompleted);

          // Check if provisioning failed
          if (stepData.status === 'failed') {
            stopTimer();
            toast.error(`VM provisioning failed: ${stepData.message}`);
            setProvisioning(false);
            return;
          }
        }

        // Check if provisioning is complete (status='active' means Azure provisioning succeeded)
        if (machine.status === 'active') {
          // Provisioning complete!
          stopTimer();
          setCompletedSteps(new Set(Object.keys(STEP_CONFIG)));
          setProvisioningComplete(true);
          toast.success('VM provisioned successfully!');
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 2000);
          return;
        }

        // Check if provisioning failed (status='inactive' + health_status='unhealthy' + not still provisioning)
        const isStillProvisioning = machine.mcp_endpoint?.includes('provisioning.local');
        if (machine.health_status === 'unhealthy' && !isStillProvisioning) {
          // Provisioning failed
          stopTimer();
          toast.error('VM provisioning failed. Check the machines list for details.');
          setProvisioning(false);
          return;
        }

        // Still provisioning, continue polling
        setTimeout(poll, pollInterval);
      } catch {
        // Network error, retry
        setTimeout(poll, pollInterval);
      }
    };

    // Start polling immediately
    poll();
  }, [stopTimer, onSuccess, onClose]);

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name) {
      toast.error('VM name is required');
      return;
    }

    // Confirm cost
    if (!confirm(`This will create a VM costing approximately $${costEstimate?.monthly}/month. Continue?`)) {
      return;
    }

    setProvisioning(true);
    setProvisioningComplete(false);
    setCurrentProvisioningStep({ step: 'queued', status: 'in_progress', message: 'Sending request...', timestamp: new Date().toISOString() });
    setCompletedSteps(new Set());
    startTimer();

    try {
      const res = await fetch('/api/admin/machines/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        stopTimer();
        toast.error(data.error || 'Failed to start provisioning');
        setProvisioning(false);
        return;
      }

      if (data.success && data.machine?.id) {
        // Provisioning started - show toast and start polling
        toast.success('VM provisioning started! Monitoring progress...');
        pollMachineStatus(data.machine.id);
      } else {
        stopTimer();
        toast.error(data.error || 'Failed to start provisioning');
        setProvisioning(false);
      }
    } catch (err) {
      console.error('Provision error:', err);
      stopTimer();
      toast.error('Failed to start provisioning');
      setProvisioning(false);
    }
  };

  // Filter and sort organizations
  const filteredOrganizations = useMemo(() => {
    return organizations
      .filter(org => {
        const searchLower = searchTerm.toLowerCase().trim();
        if (!searchLower) return true;
        return (
          org.name.toLowerCase().includes(searchLower) ||
          org.id.toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => {
        // Selected first, then alphabetically
        const aSelected = a.id === formData.organizationId;
        const bSelected = b.id === formData.organizationId;
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [organizations, searchTerm, formData.organizationId]);

  const selectedOrgName = organizations.find(o => o.id === formData.organizationId)?.name || 'None';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !provisioning && onClose()}>
      <DialogContent className="max-w-lg border-2 border-black">
        <DialogHeader className="border-b border-gray-200 pb-4">
          <DialogTitle className="text-xl font-mono font-bold flex items-center gap-2">
            <Server className="w-5 h-5" />
            PROVISION NEW VM
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : provisioning ? (
            /* Provisioning in Progress */
            <div className="space-y-4">
              {/* Header with elapsed time */}
              <div className="text-center mb-4">
                {provisioningComplete ? (
                  <Check className="w-12 h-12 mx-auto mb-4 text-black" />
                ) : (
                  <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4" />
                )}
                <p className="font-mono text-lg font-bold mb-1">
                  {provisioningComplete ? 'VM Provisioned!' : `Provisioning ${formData.name}...`}
                </p>
                <div className="flex items-center justify-center gap-2 text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span className="font-mono text-sm">
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')} elapsed
                  </span>
                </div>
              </div>

              {/* Progress bar - now based on actual step */}
              <div className="h-2 bg-gray-200 border border-gray-300">
                <div
                  className="h-full bg-black transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Current status message */}
              {currentProvisioningStep && !provisioningComplete && (
                <div className="text-center">
                  <p className="font-mono text-sm text-gray-600">
                    {currentProvisioningStep.message}
                  </p>
                </div>
              )}

              {/* Steps with real states from DB */}
              <div className="border-2 border-black p-3 bg-gray-50">
                <p className="font-mono text-xs text-gray-600 uppercase mb-3">Progress:</p>
                <ul className="space-y-2">
                  {ORDERED_STEPS.map((step) => {
                    const isComplete = provisioningComplete || completedSteps.has(step.key);
                    const isActive = !provisioningComplete && currentProvisioningStep?.step === step.key;
                    const isFailed = isActive && currentProvisioningStep?.status === 'failed';

                    return (
                      <li
                        key={step.key}
                        className={`font-mono text-sm flex items-start gap-2 transition-all ${
                          isFailed ? 'text-red-600' : isComplete ? 'text-black' : isActive ? 'text-black font-bold' : 'text-gray-400'
                        }`}
                      >
                        <span className="flex-shrink-0 mt-0.5">
                          {isComplete ? (
                            <Check className="w-4 h-4" />
                          ) : isActive ? (
                            isFailed ? (
                              <AlertTriangle className="w-4 h-4" />
                            ) : (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            )
                          ) : (
                            <span className="w-4 h-4 flex items-center justify-center">
                              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
                            </span>
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span>{step.label}</span>
                          {/* Show detailed message for active step */}
                          {isActive && currentProvisioningStep?.message && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">
                              {currentProvisioningStep.message}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {!provisioningComplete && (
                <div className="flex items-start gap-2 p-3 border-2 border-black bg-gray-100">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="font-mono text-xs">
                    <p>Do not close this dialog. The VM will be ready shortly after creation completes.</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleProvision} className="space-y-4">
              {/* VM Name */}
              <div>
                <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                  VM Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="e.g., vm3, client-vm1"
                  pattern="[a-zA-Z0-9-]+"
                  required
                />
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  Letters, numbers, and hyphens only
                </p>
              </div>

              {/* VM Size */}
              <div>
                <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                  VM Size
                </label>
                <select
                  value={formData.vmSize}
                  onChange={e => handleVmSizeChange(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  {options?.vmSizes.map(size => (
                    <option key={size.id} value={size.id}>
                      {size.name} - ${size.monthlyCost}/mo
                    </option>
                  ))}
                </select>
              </div>

              {/* Region */}
              <div>
                <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                  Region
                </label>
                <select
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  {options?.regions.map(region => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Organization with Search */}
              <div>
                <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                  Organization (for access)
                </label>
                <div className="border-2 border-black">
                  {/* Search Input */}
                  <div className="relative border-b border-gray-200">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search organizations..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-3 py-2 font-mono text-sm focus:outline-none"
                    />
                  </div>

                  {/* Selected org display */}
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 font-mono text-sm flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    <span>Selected: <strong>{selectedOrgName}</strong></span>
                  </div>

                  {/* Organization List */}
                  <ScrollArea className="h-[150px]">
                    <div className="p-2 space-y-1">
                      {filteredOrganizations.map(org => (
                        <button
                          key={org.id}
                          type="button"
                          onClick={() => setFormData({ ...formData, organizationId: org.id })}
                          className={`w-full text-left px-3 py-2 font-mono text-sm transition-colors ${
                            formData.organizationId === org.id
                              ? 'bg-black text-white'
                              : 'hover:bg-gray-100'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{org.name}</span>
                            {formData.organizationId === org.id && (
                              <Check className="w-4 h-4" />
                            )}
                          </div>
                          <div className="text-xs opacity-60 truncate">{org.id}</div>
                        </button>
                      ))}
                      {filteredOrganizations.length === 0 && (
                        <div className="text-center py-4 text-gray-500 font-mono text-sm">
                          No organizations found
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              {/* Cost Estimate */}
              {costEstimate && (
                <div className="border-2 border-black p-3 bg-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4" />
                    <span className="font-mono font-bold text-sm">ESTIMATED MONTHLY COST</span>
                  </div>
                  <div className="space-y-1">
                    {costEstimate.breakdown.map((item) => (
                      <div key={item.item} className="flex justify-between font-mono text-sm">
                        <span className="text-gray-600">{item.item}</span>
                        <span>${item.cost}</span>
                      </div>
                    ))}
                    <div className="border-t border-black pt-1 mt-1 flex justify-between font-mono font-bold">
                      <span>Total</span>
                      <span>${costEstimate.monthly}/month</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning */}
              <div className="flex items-start gap-2 p-3 border-2 border-black bg-gray-100">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="font-mono text-xs">
                  <p className="font-bold">Note:</p>
                  <p>VM will be ready in 10-15 minutes after provisioning. The Packer image includes all required software (MCP agent, VNC, etc).</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 border-2 border-black bg-black text-white font-mono text-sm hover:bg-white hover:text-black transition-colors"
                >
                  PROVISION VM
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border-2 border-black font-mono text-sm hover:bg-gray-100 transition-colors"
                >
                  CANCEL
                </button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
