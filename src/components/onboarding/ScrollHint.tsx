import React from 'react';

interface ScrollHintProps {
  show: boolean;
  onDismiss: () => void;
}

const ScrollHint: React.FC<ScrollHintProps> = ({ show, onDismiss }) => {
  
  if (!show) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center"
      onClick={onDismiss}
    >
      <div 
        className="bg-card p-8 border-2 border-border text-center rounded-lg max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-2xl mb-4 font-mono">
          🖱️ ↕️
        </div>
        <h3 className="text-lg font-bold mb-4 text-foreground">
          Navigation Tip
        </h3>
        <p className="mb-5 text-muted-foreground">
          Use your <strong className="text-foreground">mouse wheel</strong> to scroll through screenshots and navigate the timeline quickly!
        </p>
        <button 
          onClick={onDismiss} 
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90 transition-colors"
        >
          Got it!
        </button>
      </div>
    </div>
  );
};

export default ScrollHint; 