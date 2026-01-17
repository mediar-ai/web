import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bug,
  Folder,
  FolderOpen,
  Globe,
  Palette,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Settings,
  Shield,
  Trash2,
  User,
  Plus,
  Minus,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthStatus } from "@/components/auth/AuthStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { McpToolsPanel } from "@/components/ui/mcp-tools-panel";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMcp } from "@/contexts/McpContext";
import type { UserInfo } from "@/hooks/useAuth";
import { useBackgroundMode } from "@/hooks/useBackgroundMode";
import { useButtonTheme } from "@/hooks/useButtonTheme";
import { useCompactView } from "@/hooks/useCompactView";
import {
  trackSettingChanged,
  trackCompactViewToggled,
  trackTransparentBackgroundToggled,
  trackLogsSent,
  trackLogFileOpened,
  trackDevToolsOpened,
} from "@/lib/analytics";

interface AppSettings {
  workflow_recording: boolean;
  enable_shortcuts: boolean;
  error_notifications: boolean;
  analytics: boolean;
  auto_start: boolean;
  // Compact view settings
  compact_view: boolean;
  background_transparent: boolean;
  // Workflow recording settings
  enable_highlighting: boolean;
}

interface Organization {
  id: string;
  name: string;
  org_type: string;
  workflow_count: number;
}

interface ListOrgsResponse {
  success?: boolean;
  organizations: Organization[];
  total_organizations?: number;
  is_mediar_admin: boolean;
}

type ExperimentalFeatures = { xModeEnabled: boolean; generativeUIEnabled: boolean };

interface SettingsPageProps {
  user: UserInfo | null;
  onLogout: () => Promise<void>;
  onResetOnboarding?: () => void;
  onCloseSettings?: () => void;
  experimentalFeatures?: ExperimentalFeatures;
  onExperimentalFeaturesChange?: (features: ExperimentalFeatures) => void;
}

export default function SettingsPage({
  user,
  onLogout,
  onResetOnboarding,
  onCloseSettings,
  experimentalFeatures,
  onExperimentalFeaturesChange,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings>({
    workflow_recording: true,
    enable_shortcuts: false,
    error_notifications: true,
    analytics: true,
    auto_start: true,
    compact_view: false,
    background_transparent: false,
    enable_highlighting: false,
  });
  const [isSendingLogs, setIsSendingLogs] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [fontScale, setFontScale] = useState(1.0);

  // Workflow Execution toggles (persisted in localStorage)
  const [skipPreflightCheck, setSkipPreflightCheck] = useState(() => {
    const saved = localStorage.getItem("mediar-skip-preflight-check");
    // Default to true (skip preflight) when not set
    return saved === null ? true : saved === "true";
  });

  const [disableBrowserLogs, setDisableBrowserLogs] = useState(() => {
    try {
      const saved = localStorage.getItem("disable_browser_script_logs");
      // Default to true (disable browser logs) when not set
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  const [disableWindowManagement, setDisableWindowManagement] = useState(() => {
    try {
      return localStorage.getItem("disable_window_management") === "true";
    } catch {
      return false;
    }
  });

  const [disableAppMinimization, setDisableAppMinimization] = useState(() => {
    try {
      const saved = localStorage.getItem("disable_app_minimization");
      // Default to true (disable app minimization) when not set
      if (saved === null) {
        localStorage.setItem("disable_app_minimization", "true");
        return true;
      }
      return saved === "true";
    } catch {
      return true;
    }
  });

  const [disableBringToFront, setDisableBringToFront] = useState(() => {
    try {
      return localStorage.getItem("disable_bring_to_front") === "true";
    } catch {
      return false;
    }
  });

  const [disableMaximizeTarget, setDisableMaximizeTarget] = useState(() => {
    try {
      const saved = localStorage.getItem("disable_maximize_target");
      // Default to true (disable maximize target) when not set
      if (saved === null) {
        localStorage.setItem("disable_maximize_target", "true");
        return true;
      }
      return saved === "true";
    } catch {
      return true;
    }
  });

  const [disableMinimizeAlwaysOnTop, setDisableMinimizeAlwaysOnTop] = useState(() => {
    try {
      const saved = localStorage.getItem("disable_minimize_always_on_top");
      // Default to true (disable minimize always-on-top) when not set
      if (saved === null) {
        localStorage.setItem("disable_minimize_always_on_top", "true");
        return true;
      }
      return saved === "true";
    } catch {
      return true;
    }
  });

  const [showStopCancelledMessage, setShowStopCancelledMessage] = useState(() => {
    try {
      const saved = localStorage.getItem("show_stop_cancelled_message");
      // Default to true (show the message) when not set
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  // Admin view state
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [viewOrgId, setViewOrgId] = useState<string | null>(null);
  const [isMediarAdmin, setIsMediarAdmin] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  const { applyCompactView, isLoading } = useCompactView();
  const { applyBackgroundMode, isLoading: isBackgroundLoading } = useBackgroundMode();
  const { theme, toggleTheme, isClassic } = useButtonTheme();
  const mcpState = useMcp();

  useEffect(() => {
    loadSettings();
    loadFontScale();
    loadAdminViewData();
  }, []);

  // Load admin view data (organizations and current view_org_id)
  const loadAdminViewData = useCallback(async () => {
    // Check if user has @mediar.ai email
    const userEmail = user?.email?.toLowerCase() || "";
    const isAdmin = userEmail.endsWith("@mediar.ai");
    setIsMediarAdmin(isAdmin);

    if (!isAdmin) {
      return;
    }

    setLoadingOrgs(true);
    try {
      // Load current view_org_id from settings
      const currentOrgId = await invoke<string | null>("get_view_org_id");
      setViewOrgId(currentOrgId);

      // Load all organizations
      const response = await invoke<ListOrgsResponse>("list_all_organizations");
      if (response.is_mediar_admin) {
        setOrganizations(response.organizations);
      }
    } catch (error) {
      console.error("Failed to load admin view data:", error);
    } finally {
      setLoadingOrgs(false);
    }
  }, [user?.email]);

  const applyFontScale = (scale: number) => {
    document.documentElement.style.setProperty("--font-scale", scale.toString());
  };

  const loadFontScale = useCallback(() => {
    const savedScale = localStorage.getItem("fontScale");
    if (savedScale) {
      const scale = parseFloat(savedScale);
      setFontScale(scale);
      applyFontScale(scale);
    }
  }, []);

  const changeFontSize = (delta: number) => {
    const newScale = Math.max(0.7, Math.min(1.4, fontScale + delta));
    setFontScale(newScale);
    localStorage.setItem("fontScale", newScale.toString());
    applyFontScale(newScale);
  };

  // Workflow Execution toggle handlers
  const handleSkipPreflightChange = (checked: boolean) => {
    setSkipPreflightCheck(checked);
    localStorage.setItem("mediar-skip-preflight-check", String(checked));
  };

  const handleDisableBrowserLogsChange = (checked: boolean) => {
    setDisableBrowserLogs(checked);
    localStorage.setItem("disable_browser_script_logs", checked.toString());
  };

  const handleDisableWindowManagementChange = (checked: boolean) => {
    setDisableWindowManagement(checked);
    localStorage.setItem("disable_window_management", checked.toString());
  };

  const handleDisableAppMinimizationChange = (checked: boolean) => {
    setDisableAppMinimization(checked);
    localStorage.setItem("disable_app_minimization", checked.toString());
  };

  const handleDisableBringToFrontChange = (checked: boolean) => {
    setDisableBringToFront(checked);
    localStorage.setItem("disable_bring_to_front", checked.toString());
  };

  const handleDisableMaximizeTargetChange = (checked: boolean) => {
    setDisableMaximizeTarget(checked);
    localStorage.setItem("disable_maximize_target", checked.toString());
  };

  const handleDisableMinimizeAlwaysOnTopChange = (checked: boolean) => {
    setDisableMinimizeAlwaysOnTop(checked);
    localStorage.setItem("disable_minimize_always_on_top", checked.toString());
  };

  const handleShowStopCancelledMessageChange = (checked: boolean) => {
    setShowStopCancelledMessage(checked);
    localStorage.setItem("show_stop_cancelled_message", checked.toString());
  };

  // Admin view org change handler
  const handleViewOrgChange = async (orgId: string) => {
    const newOrgId = orgId === "" ? null : orgId;
    setViewOrgId(newOrgId);
    try {
      await invoke("set_view_org_id", { orgId: newOrgId });
      // Notify user that they need to refresh workflows
      console.log("View org ID updated to:", newOrgId);
    } catch (error) {
      console.error("Failed to set view_org_id:", error);
    }
  };

  const loadSettings = async () => {
    try {
      const loadedSettings = await invoke<AppSettings>("get_settings");
      setSettings(loadedSettings);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  };

  const updateSetting = async (key: keyof AppSettings, value: boolean) => {
    console.log(`🔧 Updating setting: ${key} = ${value}`);

    // Track the setting change
    if (key === "compact_view") {
      trackCompactViewToggled(value);
    } else if (key === "background_transparent") {
      trackTransparentBackgroundToggled(value);
    } else {
      trackSettingChanged(key, value);
    }

    try {
      await invoke("update_setting", { key, value });
      setSettings(prev => ({ ...prev, [key]: value }));
      console.log(`✅ Setting updated in backend: ${key} = ${value}`);

      // Apply compact view immediately if that setting was changed
      if (key === "compact_view") {
        console.log(`🎯 Applying compact view: ${value}`);
        await applyCompactView(value);
        console.log(`✅ Compact view ${value ? "enabled" : "disabled"} successfully`);
      } else if (key === "background_transparent") {
        console.log(`🎨 Applying background mode: ${value ? "transparent" : "solid"}`);
        await applyBackgroundMode(value);
        console.log(`✅ Background mode set to ${value ? "transparent" : "solid"} successfully`);
      } else if (key === "enable_shortcuts") {
        // Notify App.tsx about shortcuts setting change
        window.dispatchEvent(new CustomEvent("settings-changed"));
        console.log(`⌨️ Shortcuts ${value ? "enabled" : "disabled"} successfully`);
      } else {
        console.log("✅ Settings updated");
      }
    } catch (error) {
      console.error("❌ Failed to update setting:", error);
    }
  };

  const sendLogsToSupport = async () => {
    console.log("📤 Sending logs to support (simple mode)...");
    setIsSendingLogs(true);
    trackLogsSent();

    try {
      const result = await invoke<string>("send_logs_simple");
      console.log("✅ Logs sent successfully:", result);
      toast.success(result);
    } catch (error) {
      console.error("❌ Failed to send logs:", error);
      toast.error("Failed to send logs: " + String(error));
    } finally {
      setIsSendingLogs(false);
    }
  };

  const openLogFile = async () => {
    console.log("📂 Opening log file...");
    trackLogFileOpened();
    try {
      await invoke("open_log_file");
      console.log("✅ Log file opened");
    } catch (error) {
      console.error("❌ Failed to open log file:", error);
      toast.error("Error opening log file: " + String(error));
    }
  };

  const openLogFolder = async () => {
    console.log("📁 Opening log folder...");
    try {
      await invoke("open_log_folder");
      console.log("✅ Log folder opened");
    } catch (error) {
      console.error("❌ Failed to open log folder:", error);
      toast.error("Error opening log folder: " + String(error));
    }
  };

  const openWorkflowsFolder = async () => {
    console.log("📁 Opening workflows folder...");
    try {
      await invoke("open_workflows_folder");
      console.log("✅ Workflows folder opened");
    } catch (error) {
      console.error("❌ Failed to open workflows folder:", error);
      toast.error("Error opening workflows folder: " + String(error));
    }
  };

  const clearPackageCache = async () => {
    console.log("🧹 Clearing package cache...");
    setIsClearingCache(true);
    try {
      const result = await invoke<string>("clear_package_cache");
      console.log("✅ Package cache cleared:", result);
      toast.success(result);
    } catch (error) {
      console.error("❌ Failed to clear package cache:", error);
      toast.error("Error clearing package cache: " + String(error));
    } finally {
      setIsClearingCache(false);
    }
  };

  const openDevToolsWindow = () => {
    console.log("🔧 Opening DevTools...");
    trackDevToolsOpened();
    invoke("open_devtools", { window: getCurrentWindow() }).catch(err => {
      console.error("Failed to open DevTools:", err);
    });
  };

  const handleResetOnboarding = () => {
    if (!onResetOnboarding) {
      return;
    }
    console.log("🔄 Resetting onboarding...");
    // App.tsx handles closing settings after reset
    onResetOnboarding();
  };

  const checkForUpdates = async () => {
    console.log("🔍 Checking for updates...");
    setIsCheckingUpdates(true);
    try {
      const result = await invoke<{ version: string; current_version: string; date?: string; body?: string } | null>(
        "check_for_updates"
      );
      if (result) {
        console.log("📦 Update available:", result.version);
        // Close settings first, then emit event to show update modal
        onCloseSettings?.();
        await emit("update-available", {
          version: result.version,
          currentVersion: result.current_version,
          date: result.date,
          body: result.body,
        });
      } else {
        toast.success("You're up to date!");
      }
    } catch (error) {
      console.error("❌ Failed to check for updates:", error);
      toast.error("Failed to check for updates: " + String(error));
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const quickActions = [
    {
      key: "check-updates",
      label: isCheckingUpdates ? "Checking..." : "Check for Updates",
      icon: RefreshCw,
      onClick: checkForUpdates,
      disabled: isCheckingUpdates,
      title: "Check for available updates",
    },
    {
      key: "send-logs",
      label: isSendingLogs ? "Sending..." : "Send Logs",
      icon: Send,
      onClick: sendLogsToSupport,
      disabled: isSendingLogs,
    },
    {
      key: "view-log-file",
      label: "View Log File",
      icon: FolderOpen,
      onClick: openLogFile,
      title: "Open the current log file in text editor",
    },
    {
      key: "open-log-folder",
      label: "Open Log Folder",
      icon: Folder,
      onClick: openLogFolder,
      title: "Open the folder containing log files",
    },
    {
      key: "open-workflows-folder",
      label: "Open Workflows Folder",
      icon: FolderOpen,
      onClick: openWorkflowsFolder,
      title: "Open the folder containing workflow files",
    },
    {
      key: "devtools",
      label: "DevTools",
      icon: Bug,
      onClick: openDevToolsWindow,
      title: "Open DevTools (F12)",
    },
    {
      key: "clear-cache",
      label: isClearingCache ? "Clearing..." : "Clear All Caches",
      icon: Trash2,
      onClick: clearPackageCache,
      disabled: isClearingCache,
      title:
        "Clears node_modules from ALL workflows and global package cache. Workflows will reinstall dependencies on next run.",
    },
  ];

  return (
    <div className="w-full h-full p-6 bg-background overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Settings Header */}
        <div className="flex items-center gap-3 pb-2 border-b border-black-outline/20">
          <Settings className="w-6 h-6" />
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>

        {/* Tabbed Navigation */}
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-2 gap-2 md:grid-cols-4 mb-8 md:mb-0">
            <TabsTrigger value="general" className="flex items-center gap-2">
              <PlayCircle className="w-4 h-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="account" className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Account
            </TabsTrigger>
            <TabsTrigger value="advanced" className="flex items-center gap-2">
              <Server className="w-4 h-4" />
              Advanced
            </TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6 mt-6">
            {/* Features */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlayCircle className="w-5 h-5" />
                  Features
                </CardTitle>
                <CardDescription>Configure which features you want to use</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Workflow Recording</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Allow Mediar to record and learn from your form filling patterns
                    </div>
                  </div>
                  <Switch
                    checked={settings.workflow_recording}
                    onCheckedChange={checked => updateSetting("workflow_recording", checked)}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Visual Highlighting</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Show green highlights on UI elements during workflow recording
                    </div>
                  </div>
                  <Switch
                    checked={settings.enable_highlighting}
                    onCheckedChange={checked => updateSetting("enable_highlighting", checked)}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Enable Shortcuts</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Keyboard shortcuts for Mediar-app features and workflows
                    </div>
                  </div>
                  <Switch
                    checked={settings.enable_shortcuts}
                    onCheckedChange={checked => updateSetting("enable_shortcuts", checked)}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Start on Boot</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Automatically start Mediar when you log in to your computer
                    </div>
                  </div>
                  <Switch
                    checked={settings.auto_start}
                    onCheckedChange={checked => updateSetting("auto_start", checked)}
                  />
                </div>
                <Separator />
                <div className="space-y-3 py-1.5">
                  <div className="font-medium text-sm">Experimental Features</div>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm">X Mode</div>
                      <div className="text-xs text-muted-foreground">
                        Show X mode with limited tools (run_command, file tools only)
                      </div>
                    </div>
                    <Switch
                      checked={experimentalFeatures?.xModeEnabled ?? false}
                      onCheckedChange={checked =>
                        onExperimentalFeaturesChange?.({
                          ...experimentalFeatures,
                          xModeEnabled: checked,
                          generativeUIEnabled: experimentalFeatures?.generativeUIEnabled ?? false,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm">Generative UI</div>
                      <div className="text-xs text-muted-foreground">
                        Allow AI to render interactive components in chat
                      </div>
                    </div>
                    <Switch
                      checked={experimentalFeatures?.generativeUIEnabled ?? false}
                      onCheckedChange={checked =>
                        onExperimentalFeaturesChange?.({
                          ...experimentalFeatures,
                          xModeEnabled: experimentalFeatures?.xModeEnabled ?? false,
                          generativeUIEnabled: checked,
                        })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Workflow Execution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Workflow Execution
                </CardTitle>
                <CardDescription>Configure workflow execution behavior</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Skip Preflight Check</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Skip browser extension connectivity check before running workflows
                    </div>
                  </div>
                  <Switch checked={skipPreflightCheck} onCheckedChange={handleSkipPreflightChange} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Disable Browser Logs</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Disable console log capture for browser script steps
                    </div>
                  </div>
                  <Switch checked={disableBrowserLogs} onCheckedChange={handleDisableBrowserLogsChange} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Disable Window Management</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Disable window maximize/minimize for MCP tool actions
                    </div>
                  </div>
                  <Switch checked={disableWindowManagement} onCheckedChange={handleDisableWindowManagementChange} />
                </div>
                {/* Nested child toggles for window management */}
                <div className={`ml-4 ${disableWindowManagement ? "opacity-50" : ""}`}>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex-1 flex items-center">
                      <span className="text-muted-foreground mr-2">├─</span>
                      <div>
                        <div className="font-medium text-sm">Disable Bring to Front</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Don&apos;t bring windows to front during execution
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={disableBringToFront}
                      onCheckedChange={handleDisableBringToFrontChange}
                      disabled={disableWindowManagement}
                    />
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex-1 flex items-center">
                      <span className="text-muted-foreground mr-2">├─</span>
                      <div>
                        <div className="font-medium text-sm">Disable Maximize Target</div>
                        <div className="text-xs text-muted-foreground mt-1">Don&apos;t maximize target windows</div>
                      </div>
                    </div>
                    <Switch
                      checked={disableMaximizeTarget}
                      onCheckedChange={handleDisableMaximizeTargetChange}
                      disabled={disableWindowManagement}
                    />
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex-1 flex items-center">
                      <span className="text-muted-foreground mr-2">└─</span>
                      <div>
                        <div className="font-medium text-sm">Disable Minimize Always-on-Top</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Don&apos;t minimize always-on-top windows that may cover target
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={disableMinimizeAlwaysOnTop}
                      onCheckedChange={handleDisableMinimizeAlwaysOnTopChange}
                      disabled={disableWindowManagement}
                    />
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Disable App Minimization</div>
                    <div className="text-xs text-muted-foreground mt-1">Keep main window visible during execution</div>
                  </div>
                  <Switch checked={disableAppMinimization} onCheckedChange={handleDisableAppMinimizationChange} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Show Stop Cancelled Message</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Show &quot;Cancelled by user&quot; error in chat when clicking stop
                    </div>
                  </div>
                  <Switch checked={showStopCancelledMessage} onCheckedChange={handleShowStopCancelledMessageChange} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Reset Execution Settings</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Reset all workflow execution toggles to defaults
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const keysToRemove = [
                        "mediar-skip-preflight-check",
                        "disable_browser_script_logs",
                        "disable_window_management",
                        "disable_app_minimization",
                        "disable_bring_to_front",
                        "disable_maximize_target",
                        "disable_minimize_always_on_top",
                        "show_stop_cancelled_message",
                      ];
                      keysToRemove.forEach(key => localStorage.removeItem(key));
                      // Reset state to defaults
                      setSkipPreflightCheck(true);
                      setDisableBrowserLogs(true);
                      setDisableWindowManagement(false);
                      setDisableAppMinimization(true);
                      setDisableBringToFront(false);
                      setDisableMaximizeTarget(true);
                      setDisableMinimizeAlwaysOnTop(true);
                      setShowStopCancelledMessage(true);
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-1" />
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  Appearance
                </CardTitle>
                <CardDescription>Customize the app&apos;s appearance and layout</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between py-2">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Compact View</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Use smaller window size and fonts for better screen real estate (750×480px)
                    </div>
                  </div>
                  <Switch
                    checked={settings.compact_view}
                    disabled={isLoading}
                    onCheckedChange={checked => updateSetting("compact_view", checked)}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-2">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Transparent Background</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Use transparent glass-like background with blur effect
                    </div>
                  </div>
                  <Switch
                    checked={settings.background_transparent}
                    disabled={isBackgroundLoading}
                    onCheckedChange={checked => updateSetting("background_transparent", checked)}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-2">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Font Size</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Adjust text size across the app ({Math.round(fontScale * 100)}%)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => changeFontSize(-0.1)}
                      disabled={fontScale <= 0.7}
                      className="h-8 w-8 p-0"
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium min-w-[50px] text-center">{Math.round(fontScale * 100)}%</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => changeFontSize(0.1)}
                      disabled={fontScale >= 1.4}
                      className="h-8 w-8 p-0"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between py-2">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Classic Theme</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Use transparent buttons with borders instead of filled buttons
                    </div>
                  </div>
                  <Switch checked={isClassic} onCheckedChange={toggleTheme} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-6 mt-6">
            {/* Auth Status */}
            {user && <AuthStatus user={user} onLogout={onLogout} />}

            {/* Admin View - Only for Mediar admins */}
            {isMediarAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Admin View
                  </CardTitle>
                  <CardDescription>View workflows from other organizations</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingOrgs ? (
                    <div className="text-sm text-muted-foreground">Loading organizations...</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground mb-2">
                        Select an organization to view their workflows. Changes take effect when you return to the main
                        view.
                      </div>
                      <select
                        value={viewOrgId || ""}
                        onChange={e => handleViewOrgChange(e.target.value)}
                        className="w-full p-2 border rounded-md bg-background text-sm"
                      >
                        <option value="">My Organization (default)</option>
                        <option value="ALL">All Organizations</option>
                        {organizations.map(org => (
                          <option key={org.id} value={org.id}>
                            {org.name} ({org.workflow_count} workflow{org.workflow_count !== 1 ? "s" : ""})
                          </option>
                        ))}
                      </select>
                      {viewOrgId && (
                        <div className="flex items-center gap-2 text-xs bg-background text-foreground p-2 rounded-md border border-foreground">
                          <Globe className="w-3 h-3" />
                          <span className="font-medium">
                            Currently viewing:{" "}
                            {viewOrgId === "ALL"
                              ? "All Organizations"
                              : organizations.find(o => o.id === viewOrgId)?.name || viewOrgId}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="space-y-6 mt-6">
            {/* MCP Server Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  MCP Server Status
                </CardTitle>
                <CardDescription>Model Context Protocol server tools and status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-2xl border border-black/10 bg-background/60 p-4 shadow-inner">
                  <McpToolsPanel mcpInitializing={mcpState.isInitialSetup} />
                </div>
              </CardContent>
            </Card>

            {/* Reset Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RotateCcw className="w-5 h-5" />
                  Reset Settings
                </CardTitle>
                <CardDescription>Reset panel sizes, layout, and preferences to defaults</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="text-sm text-muted-foreground">
                      This will reset all UI preferences including panel sizes, layout mode, theme, and onboarding
                      choices. The app will reload.
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Reset UI preferences to defaults? This will reload the app.")) {
                        // Clear UI preference localStorage settings (not workflow execution)
                        const keysToRemove = [
                          "mediar-layout-mode",
                          "react-resizable-panels:workflowLayoutSizes-v2-h",
                          "react-resizable-panels:workflowLayoutSizes-v2-v",
                          "fontScale",
                          "theme",
                          "workflow_view_mode",
                        ];
                        keysToRemove.forEach(key => localStorage.removeItem(key));
                        // Reload to apply defaults
                        window.location.reload();
                      }
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-1" />
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Developer & Debug */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bug className="w-5 h-5" />
                  Developer & Debug
                </CardTitle>
                <CardDescription>Testing and troubleshooting tools</CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* Quick Actions */}
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-muted-foreground">Quick Actions</div>
                  <div className="grid gap-3 grid-cols-2">
                    {quickActions.map(action => (
                      <Button
                        key={action.key}
                        variant="outline"
                        onClick={action.onClick}
                        disabled={action.disabled}
                        title={action.title}
                        className="h-10.5 justify-start rounded-xl border-black/20 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <action.icon className="w-4 h-4 mr-2" />
                        {action.label}
                      </Button>
                    ))}
                  </div>
                  {onResetOnboarding && (
                    <div className="rounded-2xl border border-black/10 bg-black/5 p-4 space-y-3">
                      <div className="text-sm font-medium">Need a fresh start?</div>
                      <div className="text-xs text-muted-foreground">
                        Replay the onboarding tour to follow the guided setup again.
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleResetOnboarding}
                        className="w-full h-10.5 rounded-xl"
                        title="Restart the onboarding tour"
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Reset Onboarding Tour
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
                  <div className="text-sm font-semibold text-red-600">Danger Zone</div>
                  <div className="text-xs text-red-600 leading-relaxed">
                    Delete all settings, auth tokens, workflows, and localStorage. The app will close and a cleanup
                    script will run. Restart the app to see the onboarding flow.
                  </div>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (
                        window.confirm(
                          "⚠️ WARNING: This will delete ALL your data including:\n\n" +
                            "• Authentication tokens\n" +
                            "• Settings\n" +
                            "• User information\n" +
                            "• Workflows (will be backed up)\n" +
                            "• Browser cache & localStorage\n\n" +
                            "The app will close and you'll need to restart it.\n\n" +
                            "Are you absolutely sure?"
                        )
                      ) {
                        try {
                          await invoke("reset_all_user_data_and_exit");
                        } catch (error) {
                          console.error("Failed to reset user data:", error);
                          alert("Failed to reset user data: " + error);
                        }
                      }
                    }}
                    className="w-full h-10.5 rounded-xl text-sm font-semibold"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reset All Data & Exit
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
