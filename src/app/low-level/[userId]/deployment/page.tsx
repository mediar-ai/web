'use client';

import { use } from 'react';
import DeploymentsTabContent from '@/components/tabs/DeploymentsTabContent';

export default function DeploymentPage({ params }: { params: Promise<{ userId: string }> }) {
  // Extract userId from params for future use
  use(params);

  return (
    <div className="flex-1 overflow-hidden">
      <div className="h-full p-6">
        <DeploymentsTabContent />
      </div>
    </div>
  );
} 