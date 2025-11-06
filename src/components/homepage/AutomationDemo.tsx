'use client';

import styles from './AutomationDemo.module.css';

export function AutomationDemo() {
  return (
    <div className="w-full max-w-3xl mx-auto mb-12">
      <svg className={styles.automationSvg} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {/* App windows/UI elements - BIG */}
        <g opacity="0.5">
          {/* First window - input field */}
          <rect x="5" y="20" width="25" height="60" fill="white" stroke="black" strokeWidth="1" rx="2" />
          <rect x="8" y="48" width="19" height="5" fill="none" stroke="black" strokeWidth="0.7" strokeDasharray="2,1" />
          <rect x="8" y="56" width="14" height="5" fill="none" stroke="black" strokeWidth="0.7" strokeDasharray="2,1" />
          <text x="17" y="40" fontSize="3" fontFamily="monospace" textAnchor="middle" fill="black" opacity="0.4">APP 1</text>

          {/* Second window - button/action */}
          <rect x="38" y="20" width="25" height="60" fill="white" stroke="black" strokeWidth="1" rx="2" />
          <rect x="43" y="48" width="15" height="9" fill="none" stroke="black" strokeWidth="0.8" rx="1" />
          <text x="50.5" y="40" fontSize="3" fontFamily="monospace" textAnchor="middle" fill="black" opacity="0.4">APP 2</text>

          {/* Third window - dropdown/select */}
          <rect x="71" y="20" width="25" height="60" fill="white" stroke="black" strokeWidth="1" rx="2" />
          <rect x="74" y="48" width="19" height="6" fill="none" stroke="black" strokeWidth="0.7" />
          <path d="M 87 51 L 90 54 L 93 51" fill="none" stroke="black" strokeWidth="0.7" />
          <text x="83.5" y="40" fontSize="3" fontFamily="monospace" textAnchor="middle" fill="black" opacity="0.4">APP 3</text>
        </g>

        {/* Static cursor at center position - no animation */}
        <g opacity="0.85">
          {/* Cursor pointer (simplified hand) - static position */}
          <path d="M 50 51 L 50 63 L 53 60 L 56 65 L 58 63 L 55 58 L 58 58 Z" fill="black" stroke="white" strokeWidth="0.4" />
        </g>

        {/* Arrow indicators showing flow */}
        <g opacity="0.3">
          <defs>
            <marker id="arrowhead-demo" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="black" />
            </marker>
          </defs>
          <path d="M 30 10 L 37 10" stroke="black" strokeWidth="0.8" markerEnd="url(#arrowhead-demo)" />
          <path d="M 63 10 L 70 10" stroke="black" strokeWidth="0.8" markerEnd="url(#arrowhead-demo)" />
        </g>
      </svg>

      <p className="text-center text-sm text-gray-500 mt-4 font-mono">
        AUTOMATE ACROSS APPS
      </p>
    </div>
  );
}
