import { Badge } from '@/components/ui/badge';
import { describeCronExpression } from '@/lib/cronParser';
import { AlertCircle, Clock, Pause, Play } from 'lucide-react';

interface CronScheduleBadgeProps {
  cronExpression?: string | null;
  cronEnabled?: boolean;
  cronTimezone?: string;
  lastExecution?: string | null;
  nextExecution?: string | null;
  className?: string;
  showDetails?: boolean;
  onClick?: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

export function CronScheduleBadge({
  cronExpression,
  cronEnabled = false,
  cronTimezone = 'UTC',
  lastExecution,
  nextExecution,
  className = '',
  showDetails = false,
  onClick,
  onToggleEnabled
}: CronScheduleBadgeProps) {
  if (!cronExpression) {
    return null;
  }

  const isActive = cronEnabled;
  const description = describeCronExpression(cronExpression);
  
  // Format next execution time
  const formatTime = (timeString: string | null) => {
    if (!timeString) return 'Unknown';
    try {
      const date = new Date(timeString);
      return date.toLocaleString('en-US', {
        timeZone: cronTimezone,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch {
      return 'Invalid date';
    }
  };

  const badgeVariant = isActive ? 'default' : 'secondary';
  const icon = isActive ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleEnabled?.(!cronEnabled);
  };

  if (!showDetails) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Badge 
          variant={badgeVariant} 
          className={`flex items-center gap-1 ${onClick ? 'cursor-pointer hover:bg-gray-100' : ''}`}
          onClick={handleClick}
        >
          <Clock className="w-3 h-3" />
          {description}
        </Badge>
        {onToggleEnabled && (
          <button
            onClick={handleToggle}
            className="ml-1 p-1 rounded hover:bg-gray-100 transition-colors"
            title={isActive ? 'Pause schedule' : 'Resume schedule'}
          >
            {icon}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <Badge variant={badgeVariant} className="flex items-center gap-1">
        {icon}
        <Clock className="w-3 h-3" />
        {description}
      </Badge>
      
      {showDetails && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-1">
            <span className="font-medium">Expression:</span>
            <code className="px-1 py-0.5 bg-muted rounded text-xs">{cronExpression}</code>
          </div>
          
          <div className="flex items-center gap-1">
            <span className="font-medium">Timezone:</span>
            <span>{cronTimezone}</span>
          </div>
          
          {nextExecution && (
            <div className="flex items-center gap-1">
              <span className="font-medium">Next run:</span>
              <span>{formatTime(nextExecution)}</span>
            </div>
          )}
          
          {lastExecution && (
            <div className="flex items-center gap-1">
              <span className="font-medium">Last run:</span>
              <span>{formatTime(lastExecution)}</span>
            </div>
          )}
          
          <div className="flex items-center gap-1">
            <span className="font-medium">Status:</span>
            <span className={isActive ? 'text-green-600' : 'text-yellow-600'}>
              {isActive ? 'Active' : 'Paused'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function CronScheduleStatus({
  cronExpression,
  cronEnabled = false,
  className = ''
}: Pick<CronScheduleBadgeProps, 'cronExpression' | 'cronEnabled' | 'className'>) {
  if (!cronExpression) {
    return (
      <Badge variant="outline" className={`flex items-center gap-1 ${className}`}>
        <AlertCircle className="w-3 h-3" />
        No schedule
      </Badge>
    );
  }

  return (
    <CronScheduleBadge
      cronExpression={cronExpression}
      cronEnabled={cronEnabled}
      className={className}
      showDetails={false}
    />
  );
}
