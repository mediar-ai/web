import React from 'react';
import type { Event } from '../../types';

interface PipViewProps {
  events: Event[];
}

const PipView: React.FC<PipViewProps> = ({ events }) => {
  return (
    <div style={{ padding: '10px', fontFamily: 'sans-serif', fontSize: '14px', lineHeight: '1.4' }}>
      {events.slice(0, 3).map(event => (
        <div key={event.id}>
          {event.summary}
        </div>
      ))}
    </div>
  );
};

export default PipView; 