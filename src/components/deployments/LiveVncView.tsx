'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Monitor, Radio } from 'lucide-react';

interface LiveVncViewProps {
  machineId: number;
}

export function LiveVncView({ machineId }: LiveVncViewProps) {
  const [terraformKey, setTerraformKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMachineDetails = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/machines/${machineId}`);
        if (!response.ok) {
          setError('Failed to load machine details');
          return;
        }
        const data = await response.json();
        const machine = data.machine;
        setTerraformKey('vm2');
      } catch (err) {
        console.error('Error fetching machine:', err);
        setError('Failed to load machine details');
      } finally {
        setLoading(false);
      }
    };

    if (machineId) {
      fetchMachineDetails();
    }
  }, [machineId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[500px] space-y-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
        <Loader2 className="w-8 h-8 animate-spin text-black" />
        <p className="text-sm text-gray-500 font-mono uppercase tracking-widest">
          Connecting to agent...
        </p>
      </div>
    );
  }

  if (error || !terraformKey) {
    return (
      <div className="flex flex-col items-center justify-center h-[500px] space-y-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 p-8">
        <div className="bg-white p-4 rounded-full border-2 border-black shadow-sm">
          <Monitor className="w-8 h-8 text-gray-400" />
        </div>
        <div className="text-center max-w-md">
          <h3 className="font-bold text-gray-900 mb-2 font-mono uppercase">
            Connection Failed
          </h3>
          <p className="text-sm text-gray-500">
            {error || 'Could not connect to agent screen.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border-2 border-black rounded-lg overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-black">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            <h3 className="font-mono font-bold text-sm tracking-wide uppercase">
              LIVE // {terraformKey}
            </h3>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs text-gray-400 font-mono">
          <Radio className="w-3 h-3" />
          <span>READ-ONLY</span>
        </div>
      </div>
      <div className="flex-1 bg-black">
        <iframe
          src="https://vnc-gateway-e4mtrji55a-ue.a.run.app/vnc/vm2"
          className="w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
