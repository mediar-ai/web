export { inngest } from './client';
import { provisionVmFunction } from './functions/provision-vm';
import { startVmFunction, stopVmFunction, deleteVmFunction } from './functions/vm-lifecycle';
import { vmBillingCronFunction } from './functions/vm-billing';

export { provisionVmFunction, startVmFunction, stopVmFunction, deleteVmFunction, vmBillingCronFunction };

// All Inngest functions - register these in the API route
export const inngestFunctions = [
  provisionVmFunction,
  startVmFunction,
  stopVmFunction,
  deleteVmFunction,
  vmBillingCronFunction,
];
