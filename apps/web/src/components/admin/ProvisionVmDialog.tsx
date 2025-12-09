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

// Provisioning steps with estimated durations (in seconds)
const PROVISIONING_STEPS = [
  { label: 'Finding latest Packer image', duration: 5 },
  { label: 'Creating Azure resource group', duration: 10 },
  { label: 'Setting up virtual network', duration: 15 },
  { label: 'Configuring network security', duration: 10 },
  { label: 'Creating Windows VM', duration: 180 }, // 3 minutes - the big one
  { label: 'Waiting for VM to start', duration: 120 }, // 2 minutes
  { label: 'Registering in database', duration: 5 },
];

export function ProvisionVmDialog({ isOpen, onClose, onSuccess }: ProvisionVmDialogProps) {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<ProvisionOptions | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioningComplete, setProvisioningComplete] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Progress tracking
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
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

  // Calculate which step we should be on based on elapsed time
  const calculateCurrentStep = useCallback((elapsed: number) => {
    let cumulativeTime = 0;
    for (let i = 0; i < PROVISIONING_STEPS.length; i++) {
      cumulativeTime += PROVISIONING_STEPS[i].duration;
      if (elapsed < cumulativeTime) {
        return i;
      }
    }
    return PROVISIONING_STEPS.length - 1;
  }, []);

  // Start progress simulation when provisioning starts
  const startProgressSimulation = useCallback(() => {
    startTimeRef.current = Date.now();
    setCurrentStep(0);
    setElapsedSeconds(0);

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
      setCurrentStep(calculateCurrentStep(elapsed));
    }, 1000);
  }, [calculateCurrentStep]);

  // Stop progress simulation
  const stopProgressSimulation = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
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
      setCurrentStep(0);
      setElapsedSeconds(0);
      stopProgressSimulation();
    }
  }, [isOpen, stopProgressSimulation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopProgressSimulation();
  }, [stopProgressSimulation]);

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

  // Poll for machine status
  const pollMachineStatus = useCallback(async (machineId: number) => {
    const pollInterval = 5000; // 5 seconds
    const maxPollTime = 15 * 60 * 1000; // 15 minutes max
    const startTime = Date.now();

    const poll = async () => {
      if (Date.now() - startTime > maxPollTime) {
        stopProgressSimulation();
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

        // Check if provisioning is complete (status='active' means Azure provisioning succeeded)
        if (machine.status === 'active') {
          // Provisioning complete!
          stopProgressSimulation();
          setCurrentStep(PROVISIONING_STEPS.length);
          setProvisioningComplete(true);
          toast.success('VM provisioned successfully!');
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 2000);
          return;
        }

        // Check if provisioning failed (status='inactive' + health_status='unhealthy' + still has placeholder endpoint)
        const isStillProvisioning = machine.mcp_endpoint?.includes('provisioning.local');
        if (machine.health_status === 'unhealthy' && isStillProvisioning) {
          // Provisioning failed
          stopProgressSimulation();
          toast.error('VM provisioning failed. Check the machines list for details.');
          setProvisioning(false);
          return;
        }

        // Still provisioning (status='inactive', health_status='unknown', has placeholder endpoint), continue polling
        setTimeout(poll, pollInterval);
      } catch {
        // Network error, retry
        setTimeout(poll, pollInterval);
      }
    };

    // Start polling
    setTimeout(poll, pollInterval);
  }, [stopProgressSimulation, onSuccess, onClose]);

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
    startProgressSimulation();

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
        stopProgressSimulation();
        toast.error(data.error || 'Failed to start provisioning');
        setProvisioning(false);
        return;
      }

      if (data.success && data.machine?.id) {
        // Provisioning started - show toast and start polling
        toast.success('VM provisioning started! Monitoring progress...');
        pollMachineStatus(data.machine.id);
      } else {
        stopProgressSimulation();
        toast.error(data.error || 'Failed to start provisioning');
        setProvisioning(false);
      }
    } catch (err) {
      console.error('Provision error:', err);
      stopProgressSimulation();
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

              {/* Progress bar */}
              <div className="h-2 bg-gray-200 border border-gray-300">
                <div
                  className="h-full bg-black transition-all duration-1000"
                  style={{
                    width: provisioningComplete
                      ? '100%'
                      : `${Math.min(95, (currentStep / PROVISIONING_STEPS.length) * 100 + (elapsedSeconds % 30) / 3)}%`
                  }}
                />
              </div>

              {/* Steps with animated states */}
              <div className="border-2 border-black p-3 bg-gray-50">
                <p className="font-mono text-xs text-gray-600 uppercase mb-3">Progress:</p>
                <ul className="space-y-2">
                  {PROVISIONING_STEPS.map((step, i) => {
                    const isComplete = provisioningComplete || i < currentStep;
                    const isActive = !provisioningComplete && i === currentStep;

                    return (
                      <li
                        key={i}
                        className={`font-mono text-sm flex items-center gap-2 transition-all ${
                          isComplete ? 'text-black' : isActive ? 'text-black font-bold' : 'text-gray-400'
                        }`}
                      >
                        {isComplete ? (
                          <Check className="w-4 h-4 flex-shrink-0" />
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
                        ) : (
                          <span className="w-4 h-4 flex items-center justify-center">
                            <span className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
                          </span>
                        )}
                        {step.label}
                        {isActive && (
                          <span className="text-xs text-gray-500 ml-auto">
                            ~{Math.ceil(step.duration / 60)}min
                          </span>
                        )}
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
                  placeholder="e.g., vm3, imperial-vm1"
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
