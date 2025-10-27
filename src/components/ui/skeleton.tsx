import { cn } from "@/lib/utils"
import styles from './skeleton.module.css'

type SkeletonVariant = 'shimmer' | 'wireframe';

interface SkeletonProps extends React.ComponentProps<"div"> {
  variant?: SkeletonVariant;
}

function Skeleton({ className, variant = 'shimmer', ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        styles.skeleton,
        variant === 'wireframe' ? styles.wireframe : '',
        className
      )}
      {...props}
    >
      {variant === 'shimmer' && <div className={styles.shimmer} />}
      {variant === 'wireframe' && (
        <>
          {/* Automation visualization - cursor typing across apps */}
          <svg className={styles.workflowPath} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            {/* App windows/UI elements - more subtle, centered */}
            <g opacity="0.3">
              {/* First window - input field */}
              <rect x="10" y="30" width="20" height="40" fill="white" stroke="black" strokeWidth="0.8" rx="1" />
              <rect x="12" y="48" width="16" height="3" fill="none" stroke="black" strokeWidth="0.5" strokeDasharray="1.5,1" />
              <rect x="12" y="54" width="11" height="3" fill="none" stroke="black" strokeWidth="0.5" strokeDasharray="1.5,1" />

              {/* Second window - button/action */}
              <rect x="40" y="30" width="20" height="40" fill="white" stroke="black" strokeWidth="0.8" rx="1" />
              <rect x="44" y="47" width="12" height="7" fill="none" stroke="black" strokeWidth="0.6" rx="0.8" />

              {/* Third window - dropdown/select */}
              <rect x="70" y="30" width="20" height="40" fill="white" stroke="black" strokeWidth="0.8" rx="1" />
              <rect x="72" y="48" width="16" height="4" fill="none" stroke="black" strokeWidth="0.5" />
              <path d="M 83 50 L 85 52 L 87 50" fill="none" stroke="black" strokeWidth="0.5" />
            </g>

            {/* Animated cursor/hand moving and "clicking" */}
            <g opacity="0.6">
              {/* Cursor pointer (simplified hand) */}
              <path d="M 0 0 L 0 10 L 2.5 7.5 L 5 12 L 6.5 10 L 4 6 L 6.5 6 Z" fill="black" stroke="white" strokeWidth="0.25">
                <animateMotion dur="6s" repeatCount="indefinite" keyPoints="0;0.33;0.33;0.66;0.66;1;1" keyTimes="0;0.3;0.35;0.6;0.65;0.95;1">
                  <mpath href="#cursorPath" />
                </animateMotion>
                {/* Click animation */}
                <animate attributeName="opacity" values="0.6;0.9;0.6" dur="6s" repeatCount="indefinite" keyTimes="0;0.33;0.36" />
              </path>
              <path id="cursorPath" d="M 20 50 L 50 50 L 80 50" fill="none" stroke="none" />
            </g>

            {/* Typing indicator dots (appear as cursor types) */}
            <g className={styles.typingDots}>
              <circle cx="14" cy="49.5" r="0.7" fill="black" opacity="0">
                <animate attributeName="opacity" values="0;0;0.6;0;0;0" dur="6s" repeatCount="indefinite" keyTimes="0;0.15;0.25;0.3;0.8;1" />
              </circle>
              <circle cx="17" cy="49.5" r="0.7" fill="black" opacity="0">
                <animate attributeName="opacity" values="0;0;0.6;0;0;0" dur="6s" repeatCount="indefinite" keyTimes="0;0.18;0.28;0.3;0.8;1" />
              </circle>
              <circle cx="20" cy="49.5" r="0.7" fill="black" opacity="0">
                <animate attributeName="opacity" values="0;0;0.6;0;0;0" dur="6s" repeatCount="indefinite" keyTimes="0;0.21;0.31;0.32;0.8;1" />
              </circle>
            </g>
          </svg>
        </>
      )}
    </div>
  )
}

export { Skeleton }
export type { SkeletonVariant }
