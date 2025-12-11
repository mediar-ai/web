import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { VM_COSTS, VmSizeId } from '@/lib/credits';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

// Map Azure VM sizes to our internal VM size IDs
const AZURE_SIZE_MAP: Record<string, VmSizeId> = {
  'Standard_D2s_v3': 'Standard_D2s_v3',
  'Standard_D4s_v3': 'Standard_D4s_v3',
  'Standard_D8s_v3': 'Standard_D8s_v3',
};

/**
 * Cron job that runs every minute to charge credits for running VMs
 * Charges per-minute rate based on VM size
 */
export const vmBillingCronFunction = inngest.createFunction(
  {
    id: 'vm-billing-cron',
    retries: 1,
  },
  { cron: '* * * * *' }, // Every minute
  async ({ step }) => {
    const supabase = getSupabase();

    // Get all active VMs with owners
    const activeVms = await step.run('get-active-vms', async () => {
      const { data, error } = await supabase
        .from('remote_machines')
        .select('id, name, owner_user_id, owner_org_id, tags')
        .eq('status', 'active')
        .not('owner_user_id', 'is', null);

      if (error) {
        console.error('[VM Billing] Failed to fetch active VMs:', error);
        return [];
      }

      return data || [];
    });

    if (activeVms.length === 0) {
      return { charged: 0, message: 'No active VMs to bill' };
    }

    // Process each VM
    const results = await step.run('charge-vms', async () => {
      const chargeResults: Array<{ machineId: number; userId: string; charged: number; success: boolean; error?: string }> = [];

      for (const vm of activeVms) {
        if (!vm.owner_user_id) continue;

        // Determine VM size from tags or default to medium
        let vmSize: VmSizeId = 'Standard_D4s_v3';
        if (vm.tags && Array.isArray(vm.tags)) {
          const sizeTag = vm.tags.find((t: string) => t.startsWith('vmSize:'));
          if (sizeTag) {
            const size = sizeTag.replace('vmSize:', '');
            if (size in AZURE_SIZE_MAP) {
              vmSize = AZURE_SIZE_MAP[size];
            }
          }
        }

        const perMinuteCost = VM_COSTS.perMinute[vmSize];
        // Round to nearest integer (minimum 1 credit if VM is running)
        const creditsToCharge = Math.max(1, Math.round(perMinuteCost));

        // Deduct credits
        const { data: result, error } = await supabase.rpc('deduct_credits', {
          p_user_id: vm.owner_user_id,
          p_amount: creditsToCharge,
          p_type: 'vm_usage',
          p_description: `VM usage: ${vm.name} (1 min)`,
          p_reference_id: `vm-${vm.id}-${Date.now()}`,
        });

        if (error) {
          console.error(`[VM Billing] Failed to charge VM ${vm.id}:`, error);
          chargeResults.push({
            machineId: vm.id,
            userId: vm.owner_user_id,
            charged: 0,
            success: false,
            error: error.message,
          });

          // If user has insufficient credits, stop the VM
          if (error.message?.includes('Insufficient')) {
            console.log(`[VM Billing] Stopping VM ${vm.id} due to insufficient credits`);
            await inngest.send({
              name: 'vm/stop.requested',
              data: { machineId: vm.id, reason: 'insufficient_credits' },
            });
          }
        } else if (result && typeof result === 'object' && 'error_message' in result && (result as { error_message?: string }).error_message?.includes('Insufficient')) {
          // RPC returned error in result
          console.log(`[VM Billing] Stopping VM ${vm.id} due to insufficient credits`);
          chargeResults.push({
            machineId: vm.id,
            userId: vm.owner_user_id,
            charged: 0,
            success: false,
            error: 'Insufficient credits',
          });
          await inngest.send({
            name: 'vm/stop.requested',
            data: { machineId: vm.id, reason: 'insufficient_credits' },
          });
        } else {
          chargeResults.push({
            machineId: vm.id,
            userId: vm.owner_user_id,
            charged: creditsToCharge,
            success: true,
          });
        }
      }

      return chargeResults;
    });

    const successCount = results.filter(r => r.success).length;
    const totalCharged = results.reduce((sum, r) => sum + r.charged, 0);

    console.log(`[VM Billing] Charged ${totalCharged} credits across ${successCount}/${activeVms.length} VMs`);

    return {
      charged: totalCharged,
      vmsProcessed: activeVms.length,
      successful: successCount,
      results,
    };
  }
);
