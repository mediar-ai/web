'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  Maximize2,
  Minimize2,
  Settings2,
  Zap,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Machine {
  id: number;
  name: string;
  status: string;
  health_status: string;
  vnc_machine_type?: string;
}

interface ConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  url?: string;
  error?: string;
}

export default function PlaygroundPage() {
  const { user, isLoaded } = useUser();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMachineDropdown, setShowMachineDropdown] = useState(false);
  const [loadingMachines, setLoadingMachines] = useState(true);

  // Check if user is mediar admin
  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

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
          // Auto-select first machine if available
          if (activeMachines.length > 0 && !selectedMachine) {
            setSelectedMachine(activeMachines[0]);
          }
        }
      } catch (err) {
        console.error('Error fetching machines:', err);
      } finally {
        setLoadingMachines(false);
      }
    };

    if (isLoaded && user) {
      fetchMachines();
    }
  }, [isLoaded, user]);

  // Connect to VM via Guacamole
  const connectToVM = useCallback(async () => {
    if (!selectedMachine) return;

    setConnection({ status: 'connecting' });

    try {
      const response = await fetch('/api/playground/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId: selectedMachine.id }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to connect');
      }

      const data = await response.json();
      setConnection({ status: 'connected', url: data.url });
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

  // Access control
  if (!isMediarAdmin) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-96 space-y-4">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
            <Monitor className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600 font-mono">Coming soon</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className={cn(
        'flex flex-col h-[calc(100vh-2rem)]',
        isFullscreen && 'fixed inset-0 z-50 bg-white'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-black bg-white">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <h1 className="font-mono font-bold text-lg">PLAYGROUND</h1>
            </div>

            {/* Machine Selector */}
            <div className="relative">
              <button
                onClick={() => setShowMachineDropdown(!showMachineDropdown)}
                disabled={loadingMachines}
                className="flex items-center gap-2 px-3 py-1.5 border-2 border-black font-mono text-sm hover:bg-gray-50 transition-colors min-w-[200px]"
              >
                {loadingMachines ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Monitor className="w-4 h-4" />
                )}
                <span className="flex-1 text-left truncate">
                  {selectedMachine?.name || 'Select VM...'}
                </span>
                <ChevronDown className="w-4 h-4" />
              </button>

              {showMachineDropdown && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white border-2 border-black shadow-lg z-50 max-h-64 overflow-auto">
                  {machines.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 font-mono">
                      No machines available
                    </div>
                  ) : (
                    machines.map(machine => (
                      <button
                        key={machine.id}
                        onClick={() => {
                          setSelectedMachine(machine);
                          setShowMachineDropdown(false);
                          if (connection.status === 'connected') {
                            disconnect();
                          }
                        }}
                        className={cn(
                          'w-full px-3 py-2 text-left font-mono text-sm hover:bg-gray-100 transition-colors flex items-center justify-between',
                          selectedMachine?.id === machine.id && 'bg-gray-100'
                        )}
                      >
                        <span className="truncate">{machine.name}</span>
                        <span className={cn(
                          'w-2 h-2 rounded-full',
                          machine.health_status === 'healthy' ? 'bg-black' : 'bg-gray-400'
                        )} />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {connection.status === 'connected' && (
                <span className="flex items-center gap-1.5 px-2 py-1 bg-black text-white text-xs font-mono">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
              {connection.status === 'connecting' && (
                <span className="flex items-center gap-1.5 px-2 py-1 bg-gray-200 text-black text-xs font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  CONNECTING
                </span>
              )}
              {connection.status === 'error' && (
                <span className="flex items-center gap-1.5 px-2 py-1 border-2 border-black bg-white text-black text-xs font-mono">
                  <AlertCircle className="w-3 h-3" />
                  ERROR
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {connection.status === 'idle' || connection.status === 'error' ? (
              <Button
                onClick={connectToVM}
                disabled={!selectedMachine}
                className="bg-black text-white hover:bg-gray-800 font-mono text-sm"
              >
                <Play className="w-4 h-4 mr-2" />
                CONNECT
              </Button>
            ) : connection.status === 'connecting' ? (
              <Button disabled className="bg-gray-400 text-white font-mono text-sm">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                CONNECTING
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={disconnect}
                  className="border-2 border-black hover:bg-black hover:text-white font-mono text-sm"
                >
                  DISCONNECT
                </Button>
                <Button
                  variant="outline"
                  onClick={connectToVM}
                  className="border-2 border-black hover:bg-black hover:text-white font-mono text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </>
            )}

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* VM Screen */}
          <div className="flex-1 bg-black relative">
            {connection.status === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-4">
                <Monitor className="w-16 h-16 text-gray-600" />
                <p className="font-mono text-gray-500 text-sm">
                  Select a VM and click CONNECT to start
                </p>
              </div>
            )}

            {connection.status === 'connecting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-4">
                <Loader2 className="w-12 h-12 animate-spin text-gray-400" />
                <p className="font-mono text-gray-500 text-sm">
                  Establishing connection...
                </p>
              </div>
            )}

            {connection.status === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-4">
                <AlertCircle className="w-12 h-12 text-gray-500" />
                <p className="font-mono text-gray-400 text-sm">{connection.error}</p>
                <Button
                  onClick={connectToVM}
                  variant="outline"
                  className="border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white font-mono text-sm"
                >
                  RETRY
                </Button>
              </div>
            )}

            {connection.status === 'connected' && connection.url && (
              <iframe
                src={connection.url}
                className="w-full h-full border-0"
                allow="clipboard-read; clipboard-write"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            )}
          </div>

          {/* Side Panel (for future workflow controls) */}
          {!isFullscreen && (
            <div className="w-80 border-l-2 border-black bg-white flex flex-col">
              <div className="px-4 py-3 border-b-2 border-black bg-gray-50">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  <h2 className="font-mono font-bold text-sm">CONTROLS</h2>
                </div>
              </div>

              <div className="flex-1 p-4 overflow-auto">
                {selectedMachine ? (
                  <div className="space-y-4">
                    {/* Machine Info */}
                    <div className="border-2 border-black p-3">
                      <div className="font-mono text-xs text-gray-500 uppercase mb-1">
                        CONNECTED TO
                      </div>
                      <div className="font-mono font-bold text-sm">
                        {selectedMachine.name}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={cn(
                          'w-2 h-2 rounded-full',
                          selectedMachine.health_status === 'healthy' ? 'bg-black' : 'bg-gray-400'
                        )} />
                        <span className="font-mono text-xs text-gray-600">
                          {selectedMachine.health_status}
                        </span>
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="space-y-2">
                      <div className="font-mono text-xs text-gray-500 uppercase">
                        QUICK ACTIONS
                      </div>
                      <div className="text-sm text-gray-500 font-mono">
                        Workflow recording coming soon...
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Monitor className="w-8 h-8 text-gray-300 mb-2" />
                    <p className="font-mono text-sm text-gray-500">
                      Select a VM to get started
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
