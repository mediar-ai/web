import { Inngest } from 'inngest';

// Create the Inngest client
export const inngest = new Inngest({
  id: 'mediar',
  // Event schemas for type safety
});

// Event types
export interface VmProvisionRequestedEvent {
  name: 'vm/provision.requested';
  data: {
    machineId: number;
    vmName: string;
    customer: string;
    organizationId: string;
    location: string;
    vmSize: string;
  };
}

export type InngestEvents = {
  'vm/provision.requested': VmProvisionRequestedEvent;
};
