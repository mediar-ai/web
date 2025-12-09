export { inngest } from './client';
import { provisionVmFunction } from './functions/provision-vm';

export { provisionVmFunction };

// All Inngest functions - register these in the API route
export const inngestFunctions = [provisionVmFunction];
