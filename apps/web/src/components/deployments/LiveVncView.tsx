'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, Monitor, Radio, Maximize2, Minimize2, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface LiveVncViewProps {
  machineId: number;
}

export function LiveVncView({ machineId }: LiveVncViewProps) {
  const [terraformKey, setTerraformKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // Handle fullscreen changes - exit focus mode when user exits fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFocusMode(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Focus mode: enter fullscreen and focus iframe
  const enterFocusMode = useCallback(async () => {
    if (containerRef.current) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFocusMode(true);
        // Focus the iframe after a short delay to ensure fullscreen is active
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.focus();
          }
        }, 100);
      } catch (err) {
        console.error('Failed to enter fullscreen:', err);
      }
    }
  }, []);

  const exitFocusMode = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        console.error('Failed to exit fullscreen:', err);
      }
    }
    setIsFocusMode(false);
  }, []);

  // Handle double-Escape to exit focus mode (safety hatch)
  useEffect(() => {
    if (!isFocusMode) return;

    let escapeCount = 0;
    let escapeTimer: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        escapeCount++;
        if (escapeCount >= 2) {
          exitFocusMode();
          escapeCount = 0;
        } else {
          clearTimeout(escapeTimer);
          escapeTimer = setTimeout(() => {
            escapeCount = 0;
          }, 500);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(escapeTimer);
    };
  }, [isFocusMode, exitFocusMode]);

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
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-white border-2 border-black rounded-lg overflow-hidden shadow-sm"
    >
      <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-black">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            <h3 className="font-mono font-bold text-sm tracking-wide uppercase">
              LIVE // {terraformKey}
            </h3>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {isFocusMode && (
            <div className="flex items-center space-x-2 text-xs text-yellow-400 font-mono animate-pulse">
              <Keyboard className="w-3 h-3" />
              <span>KEYBOARD ACTIVE</span>
              <span className="text-gray-500">|</span>
              <span className="text-gray-400">ESC×2 to exit</span>
            </div>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-gray-800 hover:text-white"
                  onClick={isFocusMode ? exitFocusMode : enterFocusMode}
                >
                  {isFocusMode ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-mono text-xs">
                {isFocusMode ? (
                  <p>Exit focus mode (ESC×2)</p>
                ) : (
                  <p>Focus mode - capture all keyboard input</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex items-center space-x-2 text-xs text-gray-400 font-mono">
            <Radio className="w-3 h-3" />
            <span>{isFocusMode ? 'INTERACTIVE' : 'READ-ONLY'}</span>
          </div>
        </div>
      </div>
      <div className="flex-1 bg-black relative">
        <iframe
          ref={iframeRef}
          src="https://vnc-gateway-e4mtrji55a-ue.a.run.app/vnc/vm2"
          className="w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
          tabIndex={0}
        />
        {!isFocusMode && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/50 cursor-pointer group transition-opacity hover:bg-black/60"
            onClick={enterFocusMode}
          >
            <div className="text-center text-white">
              <div className="bg-white text-black p-4 rounded-full mb-4 mx-auto w-fit group-hover:scale-110 transition-transform">
                <Maximize2 className="w-8 h-8" />
              </div>
              <p className="font-mono text-sm font-bold uppercase tracking-widest mb-1">
                Click to Enter Focus Mode
              </p>
              <p className="font-mono text-xs text-gray-400">
                All keyboard input will be sent to the VM
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
