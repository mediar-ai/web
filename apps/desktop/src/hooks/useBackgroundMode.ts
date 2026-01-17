import { invoke } from '@tauri-apps/api/core';
import { useState, useCallback, useEffect } from 'react';

export interface BackgroundModeSettings {
  isTransparent: boolean;
}

/**
 * Hook to manage background mode state (transparent vs solid white)
 * Handles CSS class application for switching between transparent and solid backgrounds
 */
export function useBackgroundMode() {
  const [isTransparent, setIsTransparent] = useState(false); // Default to solid background
  const [isLoading, setIsLoading] = useState(false);

  // Load initial background mode state from settings
  useEffect(() => {
    async function loadBackgroundModeState() {
      try {
        const settings = await invoke<{ background_transparent: boolean }>('get_settings');
        const shouldBeTransparent = settings.background_transparent ?? false;

        if (!shouldBeTransparent) {
          // Apply solid background class
          document.documentElement.classList.add('solid-background');
          setIsTransparent(false);
        }
      } catch (error) {
        console.warn('Failed to load background mode state:', error);
      }
    }

    loadBackgroundModeState();
  }, []);

  /**
   * Apply background mode changes by adding/removing CSS classes
   * @param transparent - Whether to enable transparent background
   */
  const applyBackgroundMode = useCallback(async (transparent: boolean) => {
    console.log(`🎨 applyBackgroundMode called with: ${transparent ? 'transparent' : 'solid'}`);
    if (isLoading) {
      console.log(`⏸️ Already loading, skipping`);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Apply or remove solid background CSS class
      if (transparent) {
        document.documentElement.classList.remove('solid-background');
        console.log(`✅ Removed 'solid-background' class (transparent mode)`);
      } else {
        document.documentElement.classList.add('solid-background');
        console.log(`✅ Added 'solid-background' class (solid mode)`);
      }
      
      // Update state
      setIsTransparent(transparent);
      
      console.log(`✅ Applied ${transparent ? 'transparent' : 'solid'} background mode`);
      
    } catch (error) {
      console.error('❌ Failed to apply background mode:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  /**
   * Toggle between transparent and solid background
   */
  const toggleBackgroundMode = useCallback(async () => {
    await applyBackgroundMode(!isTransparent);
  }, [isTransparent, applyBackgroundMode]);

  return {
    isTransparent,
    isLoading,
    applyBackgroundMode,
    toggleBackgroundMode,
  };
}