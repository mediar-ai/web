import { RefreshCw, Eye, Loader2, ChevronDown, X, Copy, Check, ZoomIn, ImageIcon } from "lucide-react";
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useMcp } from "@/contexts/McpContext";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ApplicationInfo {
  name: string;
  process_name: string;
  pid: number;
  title?: string;
}

// Browser process names that support DOM inspection
const BROWSER_PROCESSES = ["chrome", "msedge", "firefox", "brave", "opera", "chromium", "vivaldi", "arc"];

function isBrowserApp(app: ApplicationInfo | null): boolean {
  if (!app) return false;
  const processLower = app.process_name.toLowerCase();
  return BROWSER_PROCESSES.some(browser => processLower.includes(browser));
}

type TreeType = "ui_tree" | "dom" | "ocr" | "omniparser" | "gemini";
type DisplayMode = "rectangles" | "index" | "role" | "index_role" | "name" | "index_name" | "full";
type OutputFormat = "compact" | "clustered";

const TREE_TYPES: { value: TreeType; label: string; description: string; disabled?: boolean }[] = [
  { value: "ui_tree", label: "UI Tree", description: "Native accessibility elements" },
  { value: "dom", label: "DOM", description: "Browser DOM elements" },
  { value: "ocr", label: "OCR", description: "Recognized text regions" },
  { value: "omniparser", label: "OmniParser", description: "AI-detected elements" },
  { value: "gemini", label: "Gemini Vision", description: "AI vision element detection" },
];

const DISPLAY_MODES: { value: DisplayMode; label: string }[] = [
  { value: "rectangles", label: "Rectangles only" },
  { value: "index", label: "Index" },
  { value: "role", label: "Role" },
  { value: "index_role", label: "Index + Role" },
  { value: "name", label: "Name" },
  { value: "index_name", label: "Index + Name" },
  { value: "full", label: "Full (Index:Role:Name)" },
];

const OUTPUT_FORMATS: { value: OutputFormat; label: string; description: string }[] = [
  { value: "compact", label: "Overlay + Compact", description: "Visual overlay with single source text" },
  { value: "clustered", label: "Clustered (No Overlay)", description: "Multiple sources merged by location" },
];

const STORAGE_KEY = "inspect-view-state";

// =============================================================================
// ELEMENT PARSING & INTERACTIVE TREE
// =============================================================================

interface ParsedElement {
  index: string; // e.g., "#123" or "#u1", "#d2"
  role: string;
  name: string;
  bounds?: { x: number; y: number; width: number; height: number };
  rawLine: string;
  indent: number;
}

/**
 * Parse a tree output line to extract element details
 * Handles formats like:
 * - "#123 [Button] Click me (bounds: [100,200,50,30])"
 * - "#u1 [Text] Hello World (bounds: [10,20,100,20])"
 * - "#433 [Text] 🚀 Ready to unlock the power of AI? Join"
 */
function parseElementLine(line: string): ParsedElement | null {
  // Match: #index [Role] Name (bounds: [...])
  // Support both compact (#123) and clustered (#u1, #d2, etc.) formats
  // The bounds part is optional and can appear at the end
  const match = line.match(/^(\s*)(#[a-z]?\d+)\s+\[([^\]]+)\]\s*(.*)$/);

  if (!match) return null;

  const [, indent, index, role, rest] = match;

  // Try to extract bounds from the rest of the line
  let name = rest;
  let bounds: { x: number; y: number; width: number; height: number } | undefined;

  const boundsMatch = rest.match(/^(.*?)\s*\(bounds:\s*\[(\d+),(\d+),(\d+),(\d+)\]\)\s*$/);
  if (boundsMatch) {
    name = boundsMatch[1];
    bounds = {
      x: parseInt(boundsMatch[2]),
      y: parseInt(boundsMatch[3]),
      width: parseInt(boundsMatch[4]),
      height: parseInt(boundsMatch[5]),
    };
  }

  return {
    index,
    role,
    name: name.trim(),
    bounds,
    rawLine: line,
    indent: indent.length,
  };
}

/**
 * Generate a selector string for an element
 */
function generateSelector(element: ParsedElement, processName?: string): string {
  const parts: string[] = [];

  if (element.role) {
    parts.push(`role:${element.role}`);
  }
  if (element.name) {
    parts.push(`name:${element.name}`);
  }

  const elementSelector = parts.join(" && ");

  if (processName) {
    return `process:${processName} >> ${elementSelector}`;
  }

  return elementSelector;
}

/**
 * Interactive element popover component
 */
function ElementPopover({
  element,
  processName,
  children,
}: {
  element: ParsedElement;
  processName?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const selector = generateSelector(element, processName);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
    toast.success(`Copied ${label}`);
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 shadow-xl border border-gray-200 bg-white"
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={{ top: 8, right: 8, bottom: 8, left: 8 }}
        avoidCollisions={true}
        sticky="always"
      >
        <div className="p-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-blue-600">{element.index}</span>
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-black text-white">{element.role}</span>
          </div>
          {element.name && (
            <p className="mt-1 text-sm text-gray-600 truncate" title={element.name}>
              {element.name}
            </p>
          )}
        </div>

        <div className="p-3 space-y-3 bg-white">
          {/* Selector */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-500">Selector</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs hover:bg-gray-100"
                onClick={() => copyToClipboard(selector, "selector")}
              >
                {copied === "selector" ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
            <code className="block p-2 rounded bg-gray-100 text-xs font-mono break-all text-gray-800">{selector}</code>
          </div>

          {/* Bounds */}
          {element.bounds && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-500">Bounds</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs hover:bg-gray-100"
                  onClick={() => copyToClipboard(JSON.stringify(element.bounds), "bounds")}
                >
                  {copied === "bounds" ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-1 text-xs">
                <div className="p-1.5 rounded bg-gray-100 text-center">
                  <div className="text-gray-500">x</div>
                  <div className="font-mono font-medium text-gray-800">{element.bounds.x}</div>
                </div>
                <div className="p-1.5 rounded bg-gray-100 text-center">
                  <div className="text-gray-500">y</div>
                  <div className="font-mono font-medium text-gray-800">{element.bounds.y}</div>
                </div>
                <div className="p-1.5 rounded bg-gray-100 text-center">
                  <div className="text-gray-500">w</div>
                  <div className="font-mono font-medium text-gray-800">{element.bounds.width}</div>
                </div>
                <div className="p-1.5 rounded bg-gray-100 text-center">
                  <div className="text-gray-500">h</div>
                  <div className="font-mono font-medium text-gray-800">{element.bounds.height}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Interactive tree view that renders elements with hover popovers
 */
function InteractiveTreeView({ treeOutput, processName }: { treeOutput: string; processName?: string }) {
  const lines = useMemo(() => treeOutput.split("\n"), [treeOutput]);

  return (
    <ScrollArea className="h-[400px] w-full">
      <div className="p-2 font-mono text-xs">
        {lines.map((line, idx) => {
          const element = parseElementLine(line);

          if (element) {
            return (
              <ElementPopover key={idx} element={element} processName={processName}>
                <div
                  className="cursor-pointer hover:bg-primary/10 rounded px-1 -mx-1 transition-colors whitespace-pre"
                  style={{ paddingLeft: `${element.indent * 0.5}ch` }}
                >
                  <span className="text-blue-600 font-semibold">{element.index}</span>{" "}
                  <span className="text-purple-600">[{element.role}]</span>
                  {element.name && <span className="text-gray-700"> {element.name}</span>}
                  {element.bounds && (
                    <span className="text-gray-400">
                      {" "}
                      (bounds: [{element.bounds.x},{element.bounds.y},{element.bounds.width},{element.bounds.height}])
                    </span>
                  )}
                </div>
              </ElementPopover>
            );
          }

          // Non-element lines (headers, etc.)
          return (
            <div key={idx} className="whitespace-pre text-gray-500">
              {line}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

interface PersistedState {
  selectedApp: ApplicationInfo | null;
  treeType: TreeType;
  selectedSources: TreeType[];
  outputFormat: OutputFormat;
  displayMode: DisplayMode;
  treeMaxDepth: number;
  maxDomElements: number;
  treeOutput: string;
}

const DEFAULT_SOURCES: TreeType[] = ["ui_tree"];

function loadPersistedState(): Partial<PersistedState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function savePersistedState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export function InspectView() {
  const { callTool } = useMcp();

  // Load persisted state on mount
  const persisted = loadPersistedState();

  const [applications, setApplications] = useState<ApplicationInfo[]>([]);
  const [selectedApp, setSelectedApp] = useState<ApplicationInfo | null>(persisted.selectedApp ?? null);
  const [treeType, setTreeType] = useState<TreeType>(persisted.treeType ?? "ui_tree");
  const [selectedSources, setSelectedSources] = useState<TreeType[]>(persisted.selectedSources ?? DEFAULT_SOURCES);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(persisted.outputFormat ?? "compact");
  const [isLoading, setIsLoading] = useState(false);
  const [isOverlayActive, setIsOverlayActive] = useState(false);
  const [overlayStatus, setOverlayStatus] = useState<string>("");
  const [treeOutput, setTreeOutput] = useState<string>(persisted.treeOutput ?? "");
  const [treeMaxDepth, setTreeMaxDepth] = useState<number>(persisted.treeMaxDepth ?? 30);
  const [maxDomElements, setMaxDomElements] = useState<number>(persisted.maxDomElements ?? 200);
  const [screenshotPath, setScreenshotPath] = useState<string>("");
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(persisted.displayMode ?? "index");

  // Persist state changes
  useEffect(() => {
    savePersistedState({
      selectedApp,
      treeType,
      selectedSources,
      outputFormat,
      displayMode,
      treeMaxDepth,
      maxDomElements,
      treeOutput,
    });
  }, [selectedApp, treeType, selectedSources, outputFormat, displayMode, treeMaxDepth, maxDomElements, treeOutput]);

  // Auto-switch from DOM to ui_tree when selecting a non-browser app
  useEffect(() => {
    if (treeType === "dom" && selectedApp && !isBrowserApp(selectedApp)) {
      setTreeType("ui_tree");
    }
  }, [selectedApp, treeType]);

  // Ref to store abort controller for cancelling overlay requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup: hide overlay when component unmounts (navigation away)
  useEffect(() => {
    return () => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Hide overlay on unmount
      callTool("hide_inspect_overlay", {}).catch(() => {
        // Ignore errors on cleanup
      });
    };
  }, [callTool]);

  // Track if initial fetch has been done
  const initialFetchDone = useRef(false);

  const refreshApplications = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await callTool("get_applications_and_windows_list", {});
      console.log("[InspectView] MCP response:", response);

      if (response?.isError) {
        console.error("[InspectView] Tool returned error:", response);
        toast.error("Failed to get applications");
        return;
      }

      // useMcpTools returns: { isError, content: [{type: 'text', text: '...'}] }
      const contentArray = response?.content;
      let data: Record<string, unknown> | null = null;

      if (Array.isArray(contentArray) && contentArray[0]) {
        const content = contentArray[0];
        if (content.type === "text" && content.text) {
          data = JSON.parse(content.text);
        } else if (typeof content === "object") {
          data = content as Record<string, unknown>;
        }
      }

      console.log("[InspectView] Parsed data:", data);

      if (data?.applications && Array.isArray(data.applications)) {
        setApplications(data.applications as ApplicationInfo[]);
        toast.success(`Found ${data.applications.length} applications`);
      } else {
        console.warn("[InspectView] No applications in response:", data);
        toast.error("No applications found in response");
      }
    } catch (error) {
      console.error("[InspectView] Failed to get applications:", error);
      toast.error("Failed to get applications");
    } finally {
      setIsLoading(false);
    }
  }, [callTool]);

  // Auto-fetch applications on mount
  useEffect(() => {
    if (!initialFetchDone.current) {
      initialFetchDone.current = true;
      refreshApplications();
    }
  }, [refreshApplications]);

  const showOverlay = useCallback(async () => {
    if (!selectedApp) {
      toast.error("Please select an application first");
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Hide existing overlay first
    if (isOverlayActive) {
      try {
        await callTool("hide_inspect_overlay", {});
      } catch {
        // Ignore errors when hiding
      }
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    try {
      const isClustered = outputFormat === "clustered";
      const isBrowser = isBrowserApp(selectedApp);

      // Build args based on output format
      // In clustered mode, use selectedSources checkboxes; in compact mode, use single treeType
      const includeUiTree = isClustered ? selectedSources.includes("ui_tree") : treeType === "ui_tree";
      const includeOcr = isClustered ? selectedSources.includes("ocr") : treeType === "ocr";
      const includeOmniparser = isClustered ? selectedSources.includes("omniparser") : treeType === "omniparser";
      const includeGemini = isClustered ? selectedSources.includes("gemini") : treeType === "gemini";
      const includeDom = isClustered ? selectedSources.includes("dom") && isBrowser : treeType === "dom";

      const args: Record<string, unknown> = {
        process: selectedApp.process_name,
        ui_diff_before_after: false,
        // Set output format
        tree_output_format: isClustered ? "clustered_yaml" : "compact_yaml",
        // Enable sources based on mode
        include_tree_after_action: includeUiTree,
        tree_max_depth: includeUiTree ? treeMaxDepth : undefined,
        include_ocr: includeOcr,
        include_omniparser: includeOmniparser,
        include_gemini_vision: includeGemini,
        include_browser_dom: includeDom,
        browser_dom_max_elements: includeDom ? maxDomElements : undefined,
        // Always capture screenshot for reference
        include_window_screenshot: true,
      };

      // Only show overlay in compact mode
      if (!isClustered) {
        args.show_overlay = treeType;
        args.overlay_display_mode = displayMode;
      }

      const response = await callTool("get_window_tree", args, abortController.signal, undefined, 300000);
      const contentArray = response?.content;

      if (Array.isArray(contentArray) && contentArray[0]?.text) {
        const data = JSON.parse(contentArray[0].text);
        console.log("[InspectView] Response data keys:", Object.keys(data));

        // Screenshot path can be returned in two ways:
        // 1. As a separate text content like "Window screenshot saved: C:\path\to\file.png"
        // 2. In the JSON response as window_screenshot_path
        let foundScreenshot = false;

        // Check all content items for screenshot path text
        for (const content of contentArray) {
          if (content.type === "text" && content.text?.startsWith("Window screenshot saved:")) {
            const path = content.text.replace("Window screenshot saved:", "").trim();
            console.log("[InspectView] Found screenshot path from text:", path);
            setScreenshotPath(path);
            foundScreenshot = true;
            break;
          }
        }

        // Also check JSON response (fallback for different MCP versions)
        if (!foundScreenshot) {
          const screenshotPathValue = data.window_screenshot_path || data.windowScreenshotPath;
          if (screenshotPathValue) {
            console.log("[InspectView] Found screenshot path from JSON:", screenshotPathValue);
            setScreenshotPath(screenshotPathValue);
          }
        }

        if (isClustered) {
          // Clustered mode: no overlay, just tree output
          if (data.clustered_tree) {
            setTreeOutput(data.clustered_tree);
            toast.success("Clustered tree loaded");
          } else {
            setTreeOutput("");
            toast.error("No clustered tree in response");
          }
        } else {
          // Compact mode: show overlay and single tree
          if (data.overlay_shown) {
            setIsOverlayActive(true);
            setOverlayStatus(`Overlay active: ${data.overlay_shown}`);
            toast.success(`Showing ${treeType} overlay`);
          } else if (data.overlay_error) {
            toast.error(data.overlay_error);
            setOverlayStatus(`Error: ${data.overlay_error}`);
          }

          const treeKey =
            treeType === "ui_tree"
              ? "ui_tree"
              : treeType === "dom"
                ? "browser_dom"
                : treeType === "ocr"
                  ? "ocr_tree"
                  : treeType === "gemini"
                    ? "vision_tree"
                    : "omniparser_tree";
          if (data[treeKey]) {
            setTreeOutput(typeof data[treeKey] === "string" ? data[treeKey] : JSON.stringify(data[treeKey], null, 2));
          } else {
            setTreeOutput("");
          }
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError" || abortController.signal.aborted) {
        toast.info("Overlay request cancelled");
      } else {
        console.error("Failed to show overlay:", error);
        toast.error("Failed to show overlay");
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [
    selectedApp,
    treeType,
    selectedSources,
    outputFormat,
    treeMaxDepth,
    maxDomElements,
    displayMode,
    isOverlayActive,
    callTool,
  ]);

  const cancelOverlay = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const clearForm = useCallback(async () => {
    // Cancel any pending request first
    cancelOverlay();

    setIsLoading(true);
    try {
      // Hide overlay if active
      if (isOverlayActive) {
        await callTool("hide_inspect_overlay", {});
      }

      // Reset all state to initial values
      setApplications([]);
      setSelectedApp(null);
      setTreeType("ui_tree");
      setSelectedSources(DEFAULT_SOURCES);
      setOutputFormat("compact");
      setDisplayMode("index");
      setTreeMaxDepth(30);
      setMaxDomElements(200);
      setTreeOutput("");
      setScreenshotPath("");
      setIsLightboxOpen(false);
      setIsOverlayActive(false);
      setOverlayStatus("");

      // Clear persisted state
      localStorage.removeItem(STORAGE_KEY);

      toast.success("Cleared");
    } catch (error) {
      console.error("Failed to clear:", error);
      toast.error("Failed to clear");
    } finally {
      setIsLoading(false);
    }
  }, [callTool, cancelOverlay, isOverlayActive]);

  return (
    <div className="p-2 space-y-2 overflow-x-hidden">
      {/* Controls Section - standard width */}
      <div className="max-w-2xl mx-auto space-y-2">
        {/* Application Selection Card */}
        <Card className="!gap-1 !p-2">
          <CardHeader className="!gap-0 p-0 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium leading-none">Application</CardTitle>
              <CardDescription className="text-xs leading-none mt-1">Select an application to inspect</CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={refreshApplications}
              disabled={isLoading}
              title="Refresh application list"
              className="h-8 w-8"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border rounded-md overflow-hidden bg-secondary/50">
              <ScrollArea className="h-48">
                {isLoading && applications.length === 0 ? (
                  <div className="flex items-center justify-center h-full py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading applications...</span>
                  </div>
                ) : applications.length === 0 ? (
                  <div className="flex items-center justify-center h-full py-8 text-sm text-muted-foreground">
                    No applications found
                  </div>
                ) : !selectedApp ? (
                  <div>
                    <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium">
                      👆 Select an application to continue
                    </div>
                    {applications.map(app => (
                      <button
                        key={`${app.pid}-${app.name}`}
                        onClick={() => setSelectedApp(app)}
                        className="w-full text-left px-3 py-2 text-sm transition-colors border-l-2 border-transparent hover:bg-primary/20 border-b border-border last:border-b-0"
                      >
                        <span className="truncate block">
                          {app.name || app.process_name}
                          {app.title && (
                            <span className="text-muted-foreground">
                              {" - "}
                              {app.title.substring(0, 30)}
                              {app.title.length > 30 ? "..." : ""}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    {applications.map(app => (
                      <button
                        key={`${app.pid}-${app.name}`}
                        onClick={() => setSelectedApp(app)}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm transition-colors border-l-2 border-transparent hover:bg-primary/20 border-b border-border last:border-b-0",
                          selectedApp?.pid === app.pid && "bg-primary/30 border-l-primary font-medium"
                        )}
                      >
                        <span className="truncate block">
                          {app.name || app.process_name}
                          {app.title && (
                            <span className="text-muted-foreground">
                              {" - "}
                              {app.title.substring(0, 30)}
                              {app.title.length > 30 ? "..." : ""}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        {/* Output Format Card */}
        <Card className={cn("!gap-1 !p-2", !selectedApp && "opacity-50 pointer-events-none")}>
          <CardHeader className="!gap-0 p-0">
            <CardTitle className="text-sm font-medium leading-none">Output Format</CardTitle>
            <CardDescription className="text-xs leading-none">How to display the tree output</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 gap-2">
              {OUTPUT_FORMATS.map(format => {
                const isSelected = outputFormat === format.value;
                return (
                  <button
                    key={format.value}
                    onClick={() => setOutputFormat(format.value)}
                    disabled={!selectedApp}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-md border text-left transition-all",
                      isSelected
                        ? "bg-black text-white border-black shadow-sm"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    <span className="font-medium text-sm">{format.label}</span>
                    <span className={cn("text-xs mt-0.5", isSelected ? "text-white/70" : "text-muted-foreground")}>
                      {format.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Tree Type Selection Card */}
        <Card className={cn("!gap-1 !p-2", !selectedApp && "opacity-50 pointer-events-none")}>
          <CardHeader className="!gap-0 p-0">
            <CardTitle className="text-sm font-medium leading-none">
              {outputFormat === "clustered" ? "Sources" : "Tree Type"}
            </CardTitle>
            <CardDescription className="text-xs leading-none">
              {outputFormat === "clustered" ? "Select sources to merge" : "Choose what elements to visualize"}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 gap-2">
              {TREE_TYPES.map(type => {
                // In clustered mode, use selectedSources for multi-select; in compact, use treeType for single-select
                const isSelected =
                  outputFormat === "clustered" ? selectedSources.includes(type.value) : treeType === type.value;
                // DOM is only available for browser apps
                const isTypeDisabled =
                  !selectedApp || type.disabled || (type.value === "dom" && !isBrowserApp(selectedApp));

                const handleClick = () => {
                  if (outputFormat === "clustered") {
                    // Toggle checkbox - multi-select
                    if (selectedSources.includes(type.value)) {
                      // Don't allow deselecting last source
                      if (selectedSources.length > 1) {
                        setSelectedSources(selectedSources.filter(s => s !== type.value));
                      }
                    } else {
                      setSelectedSources([...selectedSources, type.value]);
                    }
                  } else {
                    // Single select - radio behavior
                    setTreeType(type.value);
                  }
                };

                return (
                  <button
                    key={type.value}
                    disabled={isTypeDisabled}
                    onClick={handleClick}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-md border text-left transition-all",
                      isSelected
                        ? "bg-black text-white border-black shadow-sm"
                        : "bg-background border-border hover:bg-muted",
                      isTypeDisabled && "opacity-50 cursor-not-allowed hover:bg-background"
                    )}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {outputFormat === "clustered" && (
                        <div
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                            isSelected ? "bg-white border-white" : "border-current"
                          )}
                        >
                          {isSelected && <span className="text-black text-xs">✓</span>}
                        </div>
                      )}
                      <span className="font-medium text-sm">
                        {type.label}
                        {type.value === "dom" && selectedApp && !isBrowserApp(selectedApp) && " (browsers only)"}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-xs mt-0.5",
                        isSelected ? "text-white/70" : "text-muted-foreground",
                        outputFormat === "clustered" && "ml-6"
                      )}
                    >
                      {type.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Type-specific parameters */}
            {(treeType === "ui_tree" ||
              (outputFormat === "clustered" && selectedSources.includes("ui_tree")) ||
              treeType === "dom" ||
              (outputFormat === "clustered" && selectedSources.includes("dom"))) && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex items-center gap-4">
                  {(treeType === "ui_tree" ||
                    (outputFormat === "clustered" && selectedSources.includes("ui_tree"))) && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="treeMaxDepth" className="text-xs text-muted-foreground whitespace-nowrap">
                        Max Depth
                      </Label>
                      <Input
                        id="treeMaxDepth"
                        type="number"
                        min={1}
                        max={200}
                        value={treeMaxDepth}
                        onChange={e => setTreeMaxDepth(parseInt(e.target.value) || 30)}
                        className="h-8 w-20 text-sm"
                        disabled={!selectedApp}
                      />
                    </div>
                  )}
                  {(treeType === "dom" || (outputFormat === "clustered" && selectedSources.includes("dom"))) && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="maxDomElements" className="text-xs text-muted-foreground whitespace-nowrap">
                        Max Elements
                      </Label>
                      <Input
                        id="maxDomElements"
                        type="number"
                        min={1}
                        max={1000}
                        value={maxDomElements}
                        onChange={e => setMaxDomElements(parseInt(e.target.value) || 200)}
                        className="h-8 w-20 text-sm"
                        disabled={!selectedApp}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions Card */}
        <Card className={cn("!gap-1 !p-2", !selectedApp && "opacity-50 pointer-events-none")}>
          <CardHeader className="!gap-0 p-0">
            <CardTitle className="text-sm font-medium leading-none">Overlay</CardTitle>
            <CardDescription className="text-xs leading-none">Display mode and controls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-0">
            {/* Display Mode Selector */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Label Display Mode</Label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="w-full flex items-center justify-between px-3 py-2 border rounded-md text-sm bg-background hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  disabled={!selectedApp}
                >
                  <span>{DISPLAY_MODES.find(m => m.value === displayMode)?.label || displayMode}</span>
                  <ChevronDown className="w-4 h-4 ml-2 shrink-0 opacity-50" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {DISPLAY_MODES.map(mode => (
                    <DropdownMenuItem
                      key={mode.value}
                      onClick={() => setDisplayMode(mode.value)}
                      className={cn("cursor-pointer", displayMode === mode.value && "bg-gray-100 font-medium")}
                    >
                      <span className="text-sm">{mode.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Separator />

            <div className="flex gap-2">
              {isLoading ? (
                <Button variant="destructive" onClick={cancelOverlay} className="flex-1 h-11">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancel
                </Button>
              ) : (
                <Button
                  onClick={showOverlay}
                  disabled={!selectedApp}
                  className="flex-1 h-11 !bg-black !text-white !border-black hover:!bg-gray-800 disabled:opacity-50"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Run
                </Button>
              )}
              <Button
                variant="outline"
                onClick={clearForm}
                disabled={isLoading}
                className="flex-1 h-11 pointer-events-auto"
              >
                <X className="w-4 h-4 mr-2" />
                Clear
              </Button>
            </div>

            {/* Status Display */}
            {overlayStatus && (
              <>
                <Separator />
                <div className="p-3 rounded-md text-sm font-medium bg-black border border-black text-white">
                  {overlayStatus}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Screenshot Preview Card */}
      {screenshotPath && (
        <Card className="!gap-1 !p-2 min-w-0 max-w-full overflow-hidden">
          <CardHeader className="!gap-0 p-0 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium leading-none">Window Screenshot</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setIsLightboxOpen(true)}
            >
              <ZoomIn className="w-3 h-3" />
              Expand
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div
              className="relative w-full rounded-md border overflow-hidden bg-gray-100 cursor-pointer group"
              onClick={() => setIsLightboxOpen(true)}
            >
              <img
                src={`asset://localhost/${screenshotPath}`}
                alt="Window screenshot"
                className="w-full h-auto max-h-[200px] object-contain transition-transform group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-70 transition-opacity drop-shadow-lg" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lightbox Modal */}
      {isLightboxOpen && screenshotPath && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setIsLightboxOpen(false)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh]">
            <img
              src={`asset://localhost/${screenshotPath}`}
              alt="Window screenshot (expanded)"
              className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2 h-8 px-3 bg-white/90 hover:bg-white shadow-lg"
              onClick={() => setIsLightboxOpen(false)}
            >
              <X className="w-4 h-4 mr-1" />
              Close
            </Button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/70 text-xs bg-black/50 px-3 py-1 rounded-full">
              Click anywhere to close
            </div>
          </div>
        </div>
      )}

      {/* Tree Output Card - full width */}
      {treeOutput && (
        <Card className="!gap-1 !p-2 min-w-0 max-w-full overflow-x-hidden">
          <CardHeader className="!gap-0 p-0 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium leading-none">Tree Output</CardTitle>
              <CardDescription className="text-xs leading-none mt-1">
                {outputFormat === "clustered"
                  ? "All sources clustered by location"
                  : `${TREE_TYPES.find(t => t.value === treeType)?.label || treeType} structure`}
              </CardDescription>
            </div>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Click element for details</span>
          </CardHeader>
          <CardContent className="p-0 min-w-0">
            <div className="w-full min-w-0 rounded-md border overflow-hidden bg-white">
              <InteractiveTreeView treeOutput={treeOutput} processName={selectedApp?.process_name} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
