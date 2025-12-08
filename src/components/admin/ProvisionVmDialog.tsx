'use client';

import { useState, useEffect } from 'react';
import { X, Server, DollarSign, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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

interface ProvisioningStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
}

interface ProvisionVmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PROVISIONING_STEPS = [
  { step: 'image', label: 'Finding Packer image' },
  { step: 'resource_group', label: 'Creating resource group' },
  { step: 'network', label: 'Creating virtual network' },
  { step: 'public_ip', label: 'Creating public IP' },
  { step: 'nsg', label: 'Creating network security group' },
  { step: 'nic', label: 'Creating network interface' },
  { step: 'vm', label: 'Creating virtual machine' },
];

export function ProvisionVmDialog({ isOpen, onClose, onSuccess }: ProvisionVmDialogProps) {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<ProvisionOptions | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [progress, setProgress] = useState<ProvisioningStep[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    customer: '',
    vmSize: 'Standard_D4s_v3',
    location: 'eastus',
    organizationId: '',
  });

  const [costEstimate, setCostEstimate] = useState<{
    monthly: number;
    breakdown: { item: string; cost: number }[];
  } | null>(null);

  // Fetch provisioning options when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchOptions();
    } else {
      // Reset state when dialog closes
      setProgress([]);
      setProvisioning(false);
    }
  }, [isOpen]);

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
    } catch (error) {
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

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.customer) {
      toast.error('VM name and customer are required');
      return;
    }

    // Confirm cost
    if (!confirm(`This will create a VM costing approximately $${costEstimate?.monthly}/month. Continue?`)) {
      return;
    }

    setProvisioning(true);
    setProgress(PROVISIONING_STEPS.map(s => ({ step: s.step, status: 'pending', message: s.label })));

    try {
      const res = await fetch('/api/admin/machines/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (data.success) {
        // Mark all steps as completed
        setProgress(PROVISIONING_STEPS.map(s => ({
          step: s.step,
          status: 'completed',
          message: s.label,
        })));

        toast.success(data.message || 'VM provisioned successfully');

        // Show details
        if (data.machine) {
          console.log('Provisioned VM:', data.machine);
        }

        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      } else {
        toast.error(data.error || 'Failed to provision VM');
        setProvisioning(false);
        setProgress([]);
      }
    } catch (error) {
      toast.error('Failed to provision VM');
      setProvisioning(false);
      setProgress([]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white border-2 border-black w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-black text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            <span className="font-mono font-bold">PROVISION NEW VM</span>
          </div>
          <button
            onClick={onClose}
            disabled={provisioning}
            className="p-1 hover:bg-white hover:text-black transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : provisioning ? (
            /* Provisioning Progress */
            <div className="space-y-4">
              <div className="text-center mb-6">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p className="font-mono text-sm">
                  Provisioning VM... This may take 5-10 minutes.
                </p>
              </div>

              <div className="space-y-2">
                {progress.map((step, i) => (
                  <div
                    key={step.step}
                    className={`flex items-center gap-3 p-2 border ${
                      step.status === 'completed'
                        ? 'border-black bg-gray-50'
                        : step.status === 'in_progress'
                          ? 'border-black bg-gray-100'
                          : step.status === 'failed'
                            ? 'border-black bg-gray-100'
                            : 'border-gray-300'
                    }`}
                  >
                    <div className="w-5 h-5 flex items-center justify-center">
                      {step.status === 'completed' ? (
                        <Check className="w-4 h-4" />
                      ) : step.status === 'in_progress' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : step.status === 'failed' ? (
                        <X className="w-4 h-4" />
                      ) : (
                        <span className="w-2 h-2 bg-gray-300 rounded-full" />
                      )}
                    </div>
                    <span className={`font-mono text-sm ${
                      step.status === 'pending' ? 'text-gray-400' : 'text-black'
                    }`}>
                      {step.message}
                    </span>
                  </div>
                ))}
              </div>
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
                  placeholder="e.g., vm3, example-vm1"
                  pattern="[a-zA-Z0-9-]+"
                  required
                />
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  Letters, numbers, and hyphens only
                </p>
              </div>

              {/* Customer */}
              <div>
                <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                  Customer *
                </label>
                <input
                  type="text"
                  value={formData.customer}
                  onChange={e => setFormData({ ...formData, customer: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="e.g., ExampleClient"
                  required
                />
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

              {/* Organization */}
              <div>
                <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                  Organization (for access)
                </label>
                <select
                  value={formData.organizationId}
                  onChange={e => setFormData({ ...formData, organizationId: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <option value="">No organization</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
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
      </div>
    </div>
  );
}
