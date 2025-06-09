import React from 'react';
import type { Event } from '../../types';
import { Play, StopCircle } from 'lucide-react'; // Using icons

interface PipViewProps {
  events: Event[];
  onStart: () => void;
  onStop: () => void;
  isCapturing: boolean;
  mainStatus: string;
  error: string | null;
}

const PipView: React.FC<PipViewProps> = ({ events, onStart, onStop, isCapturing, mainStatus, error }) => {
  const latestEvent = events.length > 0 ? events[0].summary : 'No events yet.';
  
  const buttonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    padding: '5px'
  };

  const statusStyle: React.CSSProperties = {
    flexShrink: 0,
    padding: '5px 10px',
    backgroundColor: error ? '#C53030' : (isCapturing ? '#2B6CB0' : '#4A5568'),
    color: 'white',
    borderRadius: '5px',
    fontSize: '12px',
    whiteSpace: 'nowrap'
  };
  
  return (
    <div style={{
      backgroundColor: '#2E2E2E',
      color: '#FFFFFF',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      lineHeight: '1.5',
      height: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      padding: '0 10px',
      gap: '10px'
    }}>
      <button onClick={isCapturing ? onStop : onStart} style={buttonStyle}>
        {isCapturing ? <StopCircle size={24} /> : <Play size={24} />}
      </button>
      <div style={statusStyle}>
        {mainStatus}
      </div>
      <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {latestEvent}
      </div>
    </div>
  );
};

export default PipView; 