import { Button } from "@/components/ui/button";
import { Play, Monitor, MousePointer2 } from "lucide-react";

interface OnboardingDemoModalProps {
  open: boolean;
  onStartDemo: () => void;
}

export function OnboardingDemoModal({ open, onStartDemo }: OnboardingDemoModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-2">Ready to Create Your First Workflow!</h2>
        <p className="text-gray-600 mb-4">
          We'll now demonstrate how Mediar records your actions and turns them into reusable workflows.
        </p>

        <div className="space-y-3 mb-6">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
            <Monitor className="size-5 text-gray-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">A browser will open automatically</p>
              <p className="text-xs text-gray-500">Chrome will navigate to a demo login page</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
            <MousePointer2 className="size-5 text-gray-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Actions will be performed automatically</p>
              <p className="text-xs text-gray-500">We'll log into a practice website for you</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
            <Play className="size-5 text-gray-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Your workflow will be ready</p>
              <p className="text-xs text-gray-500">
                All actions will be captured and converted into a reusable workflow
              </p>
            </div>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          This will only take a few seconds. Click "Start Demo" when you're ready.
        </p>

        <div className="flex justify-end">
          <Button onClick={onStartDemo} className="gap-2">
            <Play className="size-4" />
            Start Demo
          </Button>
        </div>
      </div>
    </div>
  );
}
