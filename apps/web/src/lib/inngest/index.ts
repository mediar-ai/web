export { inngest } from './client';
import { provisionVmFunction } from './functions/provision-vm';
import {
  startVmFunction,
  stopVmFunction,
  deleteVmFunction,
  autoStopIdleTrialVmsFunction,
  autoDeleteOldTrialVmsFunction,
} from './functions/vm-lifecycle';
import { vmBillingCronFunction } from './functions/vm-billing';
import { costAlertsFunction, testCostAlertFunction } from './functions/cost-alerts';

export {
  provisionVmFunction,
  startVmFunction,
  stopVmFunction,
  deleteVmFunction,
  vmBillingCronFunction,
  autoStopIdleTrialVmsFunction,
  autoDeleteOldTrialVmsFunction,
  costAlertsFunction,
  testCostAlertFunction,
};

// All Inngest functions - register these in the API route
export const inngestFunctions = [
  provisionVmFunction,
  startVmFunction,
  stopVmFunction,
  deleteVmFunction,
  vmBillingCronFunction,
  autoStopIdleTrialVmsFunction,
  autoDeleteOldTrialVmsFunction,
  costAlertsFunction,
  testCostAlertFunction,
];
