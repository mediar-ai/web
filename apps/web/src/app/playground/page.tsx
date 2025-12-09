'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  Maximize2,
  Minimize2,
  ChevronDown,
  Radio,
  Keyboard,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePlaygroundAccess } from '@/hooks/usePlaygroundAccess';

interface Machine {
  id: number;
  name: string;
  status: string;
  health_status: string;
  tags?: string[];
}

interface ConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  url?: string;
  terraformKey?: string;
  error?: string;
}

export default function PlaygroundPage() {
  const { hasAccess, isLoaded } = usePlaygroundAccess();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMachineDropdown, setShowMachineDropdown] = useState(false);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch machines
  useEffect(() => {
    const fetchMachines = async () => {
      try {
        setLoadingMachines(true);
        const response = await fetch('/api/machines?show_all=true');
        if (response.ok) {
          const data = await response.json();
          const activeMachines = (data.machines || []).filter(
            (m: Machine) => m.status === 'active' && m.health_status === 'healthy'
          );
          setMachines(activeMachines);
          // Auto-select machine 22 if available, otherwise first
          if (activeMachines.length > 0 && !selectedMachine) {
            const machine22 = activeMachines.find((m: Machine) => m.id === 22);
            setSelectedMachine(machine22 || activeMachines[0]);
          }
        }
      } catch (err) {
        console.error('Error fetching machines:', err);
      } finally {
        setLoadingMachines(false);
      }
    };

    if (isLoaded && hasAccess) {
      fetchMachines();
    }
  }, [isLoaded, hasAccess, selectedMachine]);

  // Connect to VM via noVNC (like LiveVncView)
  const connectToVM = useCallback(async () => {
    if (!selectedMachine) return;

    setConnection({ status: 'connecting' });

    try {
      // Fetch machine details to get terraform key
      const response = await fetch(`/api/machines/${selectedMachine.id}`);
      if (!response.ok) {
        throw new Error('Failed to load machine details');
      }
      const data = await response.json();
      const machine = data.machine;
      setConnection({
        status: 'connected',
        terraformKey: 'vm2',
        url: 'https://vnc-gateway-e4mtrji55a-ue.a.run.app/vnc/vm2',
      });
    } catch (err) {
      setConnection({
        status: 'error',
        error: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  }, [selectedMachine]);

  // Disconnect
  const disconnect = useCallback(() => {
    setConnection({ status: 'idle' });
  }, []);

  // Auto-connect when machine selected
  useEffect(() => {
    if (selectedMachine && connection.status === 'idle') {
      connectToVM();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMachine]);

  // Loading state
  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-black" />
        </div>
      </DashboardLayout>
    );
  }

  // Access control - requires mediar admin OR playground-access feature flag
  if (!hasAccess) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-96 space-y-4">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
            <Monitor className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600 font-mono">Coming soon</p>
          <p className="text-gray-400 font-mono text-xs">Request access from your admin</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className={cn(
        'flex flex-col h-[calc(100vh-2rem)]',
        isFullscreen && 'fixed inset-0 z-50 bg-black'
      )}>
        {/* Agent Screen Style Container */}
        <div className="flex flex-col h-full bg-white border-2 border-black rounded-lg overflow-hidden shadow-sm">
          {/* Black Header - matches LiveVncView/AgentScreenTab */}
          <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-black">
            <div className="flex items-center space-x-4">
              {/* Status indicator */}
              <div className="flex items-center space-x-2">
                {connection.status === 'connected' ? (
                  <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                ) : connection.status === 'connecting' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                ) : (
                  <span className="h-2 w-2 bg-gray-600 rounded-full" />
                )}
                <h3 className="font-mono font-bold text-sm tracking-wide uppercase">
                  {connection.status === 'connected' && connection.terraformKey
                    ? `LIVE // ${connection.terraformKey}`
                    : 'PLAYGROUND'}
                </h3>
              </div>

            </div>

            {/* Right side controls */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2 text-xs text-gray-400 font-mono mr-4">
                <Radio className="w-3 h-3" />
                <span>INTERACTIVE</span>
              </div>

              {connection.status === 'connected' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={connectToVM}
                    className="h-8 text-white hover:bg-gray-800 hover:text-white font-mono text-xs"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    REFRESH
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={disconnect}
                    className="h-8 text-white hover:bg-gray-800 hover:text-white font-mono text-xs"
                  >
                    DISCONNECT
                  </Button>
                </>
              )}

              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-2 hover:bg-gray-800 transition-colors rounded"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Main Screen Area */}
          <div className="flex-1 bg-black relative">
            {connection.status === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6">
                <div className="bg-white p-4 rounded-full border-2 border-gray-700 shadow-sm">
                  <Monitor className="w-8 h-8 text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="font-mono text-gray-500 text-sm mb-4">
                    Select a VM to connect
                  </p>
                  <Button
                    onClick={connectToVM}
                    disabled={!selectedMachine}
                    className="bg-white text-black hover:bg-gray-100 font-mono text-sm"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    CONNECT
                  </Button>
                </div>
              </div>
            )}

            {connection.status === 'connecting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <p className="text-sm text-gray-500 font-mono uppercase tracking-widest">
                  Connecting to agent...
                </p>
              </div>
            )}

            {connection.status === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6 p-8">
                <div className="bg-white p-4 rounded-full border-2 border-gray-700 shadow-sm">
                  <Monitor className="w-8 h-8 text-gray-400" />
                </div>
                <div className="text-center max-w-md">
                  <h3 className="font-bold text-gray-300 mb-2 font-mono uppercase">
                    Connection Failed
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {connection.error || 'Could not connect to agent screen.'}
                  </p>
                  <Button
                    onClick={connectToVM}
                    variant="outline"
                    className="border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white font-mono text-sm"
                  >
                    RETRY
                  </Button>
                </div>
              </div>
            )}

            {connection.status === 'connected' && connection.url && (
              <iframe
                ref={iframeRef}
                src={connection.url}
                className="w-full h-full border-0"
                allow="clipboard-read; clipboard-write"
              />
            )}
          </div>

          {/* Bottom status bar */}
          {connection.status === 'connected' && (
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900 text-gray-400 text-xs font-mono border-t border-gray-800">
              <div className="flex items-center space-x-4">
                <span className="flex items-center gap-1.5">
                  <Keyboard className="w-3 h-3" />
                  Full keyboard/mouse support
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-gray-600">VM ID: {selectedMachine?.id}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
