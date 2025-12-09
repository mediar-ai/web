import React, { useMemo } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  showDots?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 100,
  height = 30,
  strokeColor = '#3b82f6',
  strokeWidth = 2,
  fillColor = 'rgba(59, 130, 246, 0.1)',
  showDots = false,
  className,
}: SparklineProps) {
  const points = useMemo(() => {
    if (data.length === 0) return '';

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    const xStep = width / (data.length - 1 || 1);
    const yScale = (height - strokeWidth * 2) / range;

    return data
      .map((value, index) => {
        const x = index * xStep;
        const y = height - (value - min) * yScale - strokeWidth;
        return `${x},${y}`;
      })
      .join(' ');
  }, [data, width, height, strokeWidth]);

  // Removed unused pathData - using points directly in the polyline

  const fillPath = useMemo(() => {
    if (!points) return '';
    const pointsArray = points.split(' ');
    const firstPoint = pointsArray[0];
    const lastPoint = pointsArray[pointsArray.length - 1];
    const lastX = lastPoint.split(',')[0];

    return `M ${firstPoint} L ${points} L ${lastX},${height} L 0,${height} Z`;
  }, [points, height]);

  if (data.length === 0) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#e5e7eb"
          strokeWidth={1}
          strokeDasharray="2,2"
        />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className={className}>
      {/* Fill area */}
      {fillColor && (
        <path
          d={fillPath}
          fill={fillColor}
          strokeWidth={0}
        />
      )}

      {/* Main line */}
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots at data points */}
      {showDots && points.split(' ').map((point, index) => {
        const [x, y] = point.split(',').map(Number);
        return (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={3}
            fill="white"
            stroke={strokeColor}
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

interface ExecutionSparklineProps {
  executions: Array<{ status: string; timestamp?: string }>;
  width?: number;
  height?: number;
  className?: string;
}

export function ExecutionSparkline({
  executions,
  width = 60,
  height = 20,
  className,
}: ExecutionSparklineProps) {
  // Convert execution statuses to numeric values for visualization
  const data = useMemo(() => {
    return executions.slice(-10).map((exec) => {
      switch (exec.status) {
        case 'completed':
        case 'success':
          return 1;
        case 'running':
          return 0.5;
        case 'failed':
        case 'error':
          return 0;
        default:
          return 0.3;
      }
    });
  }, [executions]);

  const hasFailures = data.some(d => d === 0);
  const color = hasFailures ? '#ef4444' : '#10b981';

  return (
    <Sparkline
      data={data}
      width={width}
      height={height}
      strokeColor={color}
      strokeWidth={1.5}
      fillColor={`${color}20`}
      className={className}
    />
  );
}