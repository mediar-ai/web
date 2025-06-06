import React from 'react';

interface ScrollHintProps {
  show: boolean;
  onDismiss: () => void;
}

const ScrollHint: React.FC<ScrollHintProps> = ({ show, onDismiss }) => {
  console.log('[ScrollHint Component] Render with show:', show);
  
  if (!show) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onDismiss}
    >
      <div 
        style={{ 
          backgroundColor: 'white', 
          padding: '30px', 
          border: '2px solid #000',
          fontSize: '16px',
          textAlign: 'center',
          borderRadius: '10px',
          maxWidth: '400px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{fontSize: '24px', marginBottom: '15px', fontFamily: 'monospace'}}>
          🖱️ ↕️
        </div>
        <h3 style={{margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold', color: '#000'}}>
          Navigation Tip
        </h3>
        <p style={{margin: '0 0 20px 0', color: '#666'}}>
          Use your <strong>mouse wheel</strong> to scroll through screenshots and navigate the timeline quickly!
        </p>
        <button 
          onClick={onDismiss} 
          style={{
            fontSize: '14px', 
            padding: '8px 16px', 
            backgroundColor: '#000',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Got it!
        </button>
      </div>
    </div>
  );
};

export default ScrollHint; 