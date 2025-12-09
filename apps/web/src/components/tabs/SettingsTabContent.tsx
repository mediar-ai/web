import React from 'react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { SettingsTabContentProps } from '../../types';

const SettingsTabContent: React.FC<SettingsTabContentProps> = ({
  customPrompt,
  handlePromptChange,
  promptSaveStatus,
  eventsPrompt,
  EVENTS_MODEL_NAME,
  autoDetectionEnabled,
  setAutoDetectionEnabled,
  monitoringFrequency,
  setMonitoringFrequency,
  changeThreshold,
  setChangeThreshold,
  stabilityDelay,
  setStabilityDelay,
  screenshotQuality,
  setScreenshotQuality,
  maxScreenshots,
  setMaxScreenshots,
  pixelDifferenceThreshold,
  setPixelDifferenceThreshold,
  stream,
  activeAnalysesCount,
}) => {
  // The test comment will be removed here; it served its purpose in page.tsx
  return (
    <Card className='shadow-sm border-0 p-0 relative'>
      <div className='p-3 space-y-4'>
        <div>
          <label className='text-xs font-medium text-muted-foreground mb-2 block'>
            Workflow Analysis Prompt
          </label>
          <div className='relative'>
            <Textarea
              value={customPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder='Enter analysis prompt...'
              className='text-xs min-h-[120px] resize-none overflow-y-scroll'
              style={{ scrollbarWidth: 'thin' }}
              disabled={!!stream && activeAnalysesCount > 0}
            />
            {promptSaveStatus !== 'idle' && (
              <div
                className={`absolute top-2 right-2 px-3 py-1 rounded-md text-xs font-medium transition-all duration-300 ${
                  promptSaveStatus === 'saving'
                    ? 'bg-blue-100 text-blue-700 animate-pulse'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {promptSaveStatus === 'saving'
                  ? 'Saving...'
                  : 'Saved!'}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className='text-xs font-medium text-muted-foreground mb-2 block'>
            Events Summary Prompt
          </label>
          <div className='p-2 bg-muted rounded-md'>
            <code className='text-xs text-foreground'>
              {eventsPrompt}
            </code>
          </div>
          <p className='text-[10px] text-muted-foreground mt-1'>
            Uses model: {EVENTS_MODEL_NAME}
          </p>
        </div>

        <div className='border-t pt-3'>
          <h3 className='text-xs font-medium text-foreground mb-3'>
            Auto-Detection Settings
          </h3>

          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <label className='text-xs text-muted-foreground'>
                Enable Auto-Detection
              </label>
              <button
                onClick={() =>
                  setAutoDetectionEnabled(!autoDetectionEnabled)}
                className={`w-10 h-6 rounded-full transition-colors ${
                  autoDetectionEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white dark:bg-gray-900 transition-transform ${
                    autoDetectionEnabled
                      ? 'translate-x-5'
                      : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div>
              <label className='text-xs text-muted-foreground mb-1 block'>
                Monitoring Frequency: {monitoringFrequency}ms
              </label>
              <input
                type='range'
                min='100'
                max='1000'
                step='100'
                value={monitoringFrequency}
                onChange={(e) =>
                  setMonitoringFrequency(Number(e.target.value))}
                className='w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground mt-1'>
                <span>100ms</span>
                <span>1000ms</span>
              </div>
            </div>

            <div>
              <label className='text-xs text-muted-foreground mb-1 block'>
                Change Threshold: {changeThreshold}%
              </label>
              <input
                type='range'
                min='0.5'
                max='5'
                step='0.5'
                value={changeThreshold}
                onChange={(e) =>
                  setChangeThreshold(Number(e.target.value))}
                className='w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground mt-1'>
                <span>0.5%</span>
                <span>5%</span>
              </div>
            </div>

            <div>
              <label className='text-xs text-muted-foreground mb-1 block'>
                Stability Delay: {stabilityDelay / 1000}s
              </label>
              <input
                type='range'
                min='1000'
                max='10000'
                step='1000'
                value={stabilityDelay}
                onChange={(e) =>
                  setStabilityDelay(Number(e.target.value))}
                className='w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground mt-1'>
                <span>1s</span>
                <span>10s</span>
              </div>
            </div>

            <div>
              <label className='text-xs text-muted-foreground mb-1 block'>
                Screenshot Quality:{' '}
                {Math.round(screenshotQuality * 100)}%
              </label>
              <input
                type='range'
                min='0.1'
                max='1'
                step='0.05'
                value={screenshotQuality}
                onChange={(e) =>
                  setScreenshotQuality(Number(e.target.value))}
                className='w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground mt-1'>
                <span>10%</span>
                <span>100%</span>
              </div>
            </div>

            <div>
              <label className='text-xs text-muted-foreground mb-1 block'>
                Max Screenshots (DB): {maxScreenshots}
              </label>{' '}
              <input
                type='range'
                min='10'
                max='200'
                step='10'
                value={maxScreenshots}
                onChange={(e) =>
                  setMaxScreenshots(Number(e.target.value))}
                className='w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground mt-1'>
                <span>10</span>
                <span>200</span>
              </div>
            </div>

            <div>
              <label className='text-xs text-muted-foreground mb-1 block'>
                Pixel Difference Threshold: {pixelDifferenceThreshold}
              </label>
              <input
                type='range'
                min='0'
                max='255'
                step='1'
                value={pixelDifferenceThreshold}
                onChange={(e) =>
                  setPixelDifferenceThreshold(Number(e.target.value))}
                className='w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground mt-1'>
                <span>0</span>
                <span>255</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default SettingsTabContent; 