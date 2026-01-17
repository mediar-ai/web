import { Button } from "@/components/ui/button";

interface FirstRecordingSuccessProps {
  open: boolean;
  workflowName: string;
  steps: any[];
  onRunWorkflow: () => void;
  onSaveForLater: () => void;
}

function getStepDisplayName(step: any): string {
  const toolName = step.tool_name || step.tool || "Unknown";
  const simplifications: Record<string, string> = {
    click_element: "Clicked",
    type_into_element: "Typed",
    navigate_browser: "Navigated to",
    press_key: "Pressed key",
    open_application: "Opened",
    switch_application: "Switched to",
  };

  const simpleName = simplifications[toolName] || toolName;
  const args = step.arguments || step.parameters || {};

  if (toolName === "type_into_element" && args.text_to_type) {
    return 'Typed "' + args.text_to_type + '"';
  }

  if (step.description) {
    return step.description;
  }

  return step.name || simpleName;
}

export function FirstRecordingSuccess({
  open,
  workflowName,
  steps,
  onRunWorkflow,
  onSaveForLater,
}: FirstRecordingSuccessProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-2">Recording Complete!</h2>
        <p className="text-gray-600 mb-4">We captured {steps.length} steps:</p>

        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {steps.slice(0, 10).map((step, index) => (
            <div key={index} className="flex items-start gap-2 text-sm p-2 rounded bg-gray-100">
              <span className="text-gray-500 shrink-0">•</span>
              <span>{getStepDisplayName(step)}</span>
            </div>
          ))}
          {steps.length > 10 && (
            <div className="text-xs text-gray-500 text-center pt-2">... and {steps.length - 10} more steps</div>
          )}
        </div>

        <p className="text-sm font-medium mb-4">Want to see it run automatically?</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onSaveForLater}>
            Save for Later
          </Button>
          <Button onClick={onRunWorkflow}>Run It!</Button>
        </div>
      </div>
    </div>
  );
}
