import React from 'react';
import type { Event } from '../../types';

interface PipViewProps {
  events: Event[];
  onStart: () => void;
  onStop: () => void;
  isCapturing: boolean;
  mainStatus: string;
  error: string | null;
}

const PipView: React.FC<PipViewProps> = ({ events, onStart, onStop, isCapturing, mainStatus, error }) => {
  return (
    <div style={{
      backgroundColor: '#2E2E2E',
      color: '#FFFFFF',
      padding: '15px',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      lineHeight: '1.5',
      height: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div>
        {events.slice(0, 3).map(event => (
          <div key={event.id}>
            {event.summary}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px', alignItems: 'center' }}>
        <button onClick={onStart} disabled={isCapturing} style={{ flex: 1, padding: '8px', cursor: 'pointer' }}>Start</button>
        <button onClick={onStop} disabled={!isCapturing} style={{ flex: 1, padding: '8px', cursor: 'pointer' }}>Stop</button>
        <div style={{
          flex: 2,
          textAlign: 'center',
          padding: '5px',
          backgroundColor: error ? '#C53030' : (isCapturing ? '#2B6CB0' : '#4A5568'),
          color: 'white',
          borderRadius: '5px',
          fontSize: '12px'
        }}>
          {mainStatus}
        </div>
      </div>
    </div>
  );
};

export default PipView; 