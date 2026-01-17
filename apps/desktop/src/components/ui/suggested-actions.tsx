import { Sparkles, Play, Edit, Zap, MessageSquare } from "lucide-react";
import { Button } from "./button";
import { SpotlightHint } from "@/components/onboarding";

export interface SuggestedAction {
  id: string;
  title: string;
  description: string;
  icon?: "play" | "edit" | "zap" | "message" | "sparkles";
  prompt: string;
}

interface SuggestedActionsProps {
  workflowName?: string;
  actions: SuggestedAction[];
  onActionClick: (prompt: string) => void;
  isGenerating?: boolean;
  spotlightActionId?: string | null; // ID of action to spotlight (for onboarding)
  spotlightTooltip?: string; // Tooltip text for spotlighted action
}

const iconMap = {
  play: Play,
  edit: Edit,
  zap: Zap,
  message: MessageSquare,
  sparkles: Sparkles,
};

export const SuggestedActions: React.FC<SuggestedActionsProps> = ({
  workflowName,
  actions,
  onActionClick,
  isGenerating = false,
  spotlightActionId,
  spotlightTooltip = "Click this action",
}) => {
  return (
    <div className="w-full space-y-2 py-2">
      {/* Suggested Actions - Compact horizontal layout */}
      <div className="flex flex-wrap justify-center gap-2">
        {actions.map(action => {
          const Icon = action.icon ? iconMap[action.icon] : Sparkles;
          const isSpotlighted = spotlightActionId === action.id;
          const button = (
            <Button
              key={action.id}
              onClick={() => onActionClick(action.prompt)}
              variant="default"
              size="sm"
              className="h-auto px-3 py-2 flex items-center gap-2 transition-all duration-200 group text-xs"
              title={action.description}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{action.title}</span>
            </Button>
          );

          if (isSpotlighted) {
            return (
              <SpotlightHint key={action.id} show={true} tooltip={spotlightTooltip} arrowPosition="top">
                {button}
              </SpotlightHint>
            );
          }

          return button;
        })}
      </div>

      {/* AI Generation Loading Indicator */}
      {isGenerating && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-black mt-2">
          <span className="animate-pulse">Generating AI suggestions...</span>
        </div>
      )}
    </div>
  );
};
