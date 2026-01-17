import { Check, ChevronDown, ChevronUp, Zap, Video, Play, Wand2, X, Columns } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface OnboardingTask {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  completed: boolean;
  action?: () => void;
  actionLabel?: string;
}

interface OnboardingChecklistProps {
  tasks: OnboardingTask[];
  onDismiss: () => void;
  onTaskAction?: (taskId: string) => void;
}

const DEFAULT_TASKS: OnboardingTask[] = [
  {
    id: "record",
    title: "Record your first workflow",
    description: "Click the record button and perform any desktop action",
    icon: <Video className="w-4 h-4" />,
    completed: false,
    actionLabel: "Start Recording",
  },
  {
    id: "run",
    title: "Run a workflow",
    description: "Play back your recorded workflow to see it in action",
    icon: <Play className="w-4 h-4" />,
    completed: false,
    actionLabel: "Run Workflow",
  },
  {
    id: "edit",
    title: "Edit with AI",
    description: "Ask AI to modify or improve your workflow",
    icon: <Wand2 className="w-4 h-4" />,
    completed: false,
    actionLabel: "Try AI Edit",
  },
];

export function OnboardingChecklist({ tasks = DEFAULT_TASKS, onDismiss, onTaskAction }: OnboardingChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  const completedCount = tasks.filter(t => t.completed).length;
  const progress = (completedCount / tasks.length) * 100;
  const allCompleted = completedCount === tasks.length;

  // Auto-dismiss when all tasks are completed (after a delay)
  useEffect(() => {
    if (allCompleted) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [allCompleted, onDismiss]);

  if (!isVisible && allCompleted) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-40",
        "w-80 bg-white border-2 border-black rounded-lg shadow-xl",
        "transition-all duration-300 ease-out",
        !isVisible && "opacity-0 translate-y-4"
      )}
    >
      {/* Header */}
      <div className="p-4 cursor-pointer border-b border-gray-200" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-mono font-bold text-black text-sm">Getting Started</h3>
              <p className="text-xs text-gray-500 font-mono">
                {allCompleted ? "All done!" : `${completedCount}/${tasks.length} completed`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={e => {
                e.stopPropagation();
                onDismiss();
              }}
              className="p-1.5 hover:bg-gray-100 rounded transition-colors border border-transparent hover:border-black"
              title="Dismiss checklist"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
            <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              )}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden border border-black">
          <div
            className={cn("h-full rounded-full transition-all duration-500 ease-out", "bg-black")}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Tasks list */}
      {isExpanded && (
        <div className="p-3 space-y-2">
          {/* Pro Tip: Side by side windows */}
          <div className="p-3 rounded-md border-2 border-dashed border-gray-300 bg-gray-50">
            <div className="flex items-start gap-2">
              <Columns className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-medium text-gray-700 mb-2">Pro tip: Work side by side</p>
                {/* ASCII-style window arrangement visual */}
                <div className="font-mono text-[10px] leading-tight text-gray-500 bg-white border border-gray-200 rounded p-2 mb-2">
                  <div className="flex gap-1">
                    <div className="flex-1 border border-gray-300 rounded-sm p-1">
                      <div className="text-[8px] text-gray-400 border-b border-gray-200 mb-0.5">Mediar</div>
                      <div className="text-gray-400">{"[ workflow ]"}</div>
                    </div>
                    <div className="flex-1 border border-gray-300 rounded-sm p-1">
                      <div className="text-[8px] text-gray-400 border-b border-gray-200 mb-0.5">Your App</div>
                      <div className="text-gray-400">{"[  target  ]"}</div>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">
                  Click{" "}
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-gray-200 rounded text-gray-700 font-medium">
                    <Columns className="w-2.5 h-2.5" />
                  </span>{" "}
                  in the toolbar to auto-arrange windows
                </p>
              </div>
            </div>
          </div>

          {tasks.map(task => (
            <div
              key={task.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-md border-2 transition-all duration-200",
                task.completed ? "bg-gray-50 border-gray-200" : "bg-white border-black hover:bg-gray-50"
              )}
            >
              {/* Checkbox */}
              <div
                className={cn(
                  "flex-shrink-0 w-5 h-5 rounded-full border-2",
                  "flex items-center justify-center",
                  "transition-all duration-200",
                  task.completed ? "bg-black border-black text-white" : "border-black bg-white"
                )}
              >
                {task.completed && <Check className="w-3 h-3" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={cn(
                      "text-sm font-mono font-medium",
                      task.completed ? "text-gray-500 line-through" : "text-black"
                    )}
                  >
                    {task.title}
                  </span>
                </div>
                <p className={cn("text-xs", task.completed ? "text-gray-400" : "text-gray-500")}>{task.description}</p>

                {/* Action button */}
                {!task.completed && task.actionLabel && onTaskAction && (
                  <button
                    onClick={() => onTaskAction(task.id)}
                    className={cn(
                      "mt-2 px-3 py-1 rounded",
                      "text-xs font-mono font-bold",
                      "bg-black text-white border-2 border-black",
                      "hover:bg-gray-800 transition-colors"
                    )}
                  >
                    {task.actionLabel}
                  </button>
                )}
              </div>

              {/* Icon */}
              <div
                className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-md border-2",
                  "flex items-center justify-center",
                  task.completed ? "bg-gray-100 border-gray-200 text-gray-400" : "bg-black border-black text-white"
                )}
              >
                {task.icon}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Celebration effect when all complete */}
      {allCompleted && (
        <div className="p-3 border-t border-gray-200">
          <div className="p-3 rounded-md bg-black text-white text-center border-2 border-black">
            <p className="text-sm font-mono font-bold">You&apos;re all set!</p>
            <p className="text-xs opacity-80">You&apos;ve mastered the basics</p>
          </div>
        </div>
      )}
    </div>
  );
}
