"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    $crisp: any;
    CRISP_WEBSITE_ID: string;
    crispShowPreview?: (message: string) => void;
    crispTriggerAttention?: () => void;
  }
}

// Global flag to ensure Crisp only initializes once per browser session
let crispInitialized = false;

// localStorage keys for position and hidden state
const CRISP_POS_LEFT = "crisp_position_left";
const CRISP_POS_BOTTOM = "crisp_position_bottom";
const CRISP_HIDDEN = "crisp_hidden";
const DEFAULT_LEFT = 20;
const DEFAULT_BOTTOM = 40;

function getSavedPosition(): { left: number; bottom: number } {
  const left = parseInt(localStorage.getItem(CRISP_POS_LEFT) || String(DEFAULT_LEFT), 10);
  const bottom = parseInt(localStorage.getItem(CRISP_POS_BOTTOM) || String(DEFAULT_BOTTOM), 10);
  console.log("[CrispDrag] Loaded position from localStorage:", { left, bottom });
  return { left, bottom };
}

function savePosition(left: number, bottom: number): void {
  localStorage.setItem(CRISP_POS_LEFT, String(left));
  localStorage.setItem(CRISP_POS_BOTTOM, String(bottom));
  console.log("[CrispDrag] Saved position to localStorage:", { left, bottom });
}

export function CrispChat() {
  const websiteId = import.meta.env.VITE_CRISP_WEBSITE_ID;

  // Temporarily disable error suppression to see actual errors
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("🔴 ERROR CAPTURED:", event.message, event);
    };

    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("error", handleError);
    };
  }, []);

  // Initialize Crisp Chat - ONLY ONCE per browser session
  useEffect(() => {
    // Skip if already initialized or no website ID
    if (crispInitialized || !websiteId) {
      if (!websiteId) {
        console.warn("VITE_CRISP_WEBSITE_ID is not set");
      }
      return;
    }

    // Mark as initialized immediately to prevent race conditions
    crispInitialized = true;
    console.log("🎯 Initializing Crisp chat (one-time only)");

    try {
      // Get saved position for initial CSS
      const savedPos = getSavedPosition();

      // Add CSS FIRST before anything else
      const baseStyle = document.createElement("style");
      baseStyle.id = "crisp-base-styles";
      baseStyle.innerHTML = `
        /* CSS variables for dynamic positioning */
        :root {
          --crisp-left: ${savedPos.left}px;
          --crisp-bottom: ${savedPos.bottom}px;
        }
        /* Position Crisp in left bottom corner */
        .crisp-client,
        .crisp-client .cc-tlyw,
        .crisp-client > div,
        div[data-id="crisp-chatbox"] {
          position: fixed !important;
          bottom: var(--crisp-bottom) !important;
          left: var(--crisp-left) !important;
          right: auto !important;
          z-index: 99999 !important;
          max-height: calc(100vh - 40px) !important;
          max-width: 400px !important;
        }
        /* Grip handle for dragging - positioned outside Crisp DOM */
        .crisp-drag-handle {
          position: fixed;
          width: 28px;
          height: 14px;
          background: transparent;
          border: none;
          border-radius: 0 0 4px 4px;
          cursor: grab;
          z-index: 100001;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.6;
          transition: opacity 0.2s;
          pointer-events: auto;
        }
        .crisp-drag-handle:hover {
          opacity: 1;
        }
        .crisp-drag-handle:active {
          cursor: grabbing;
        }
        /* Grip dots pattern */
        .crisp-drag-handle::before {
          content: "⋮⋮";
          color: #666;
          font-size: 10px;
          letter-spacing: 2px;
          font-weight: bold;
        }
        /* Dark grey hide button - right of drag handle */
        .crisp-hide-button {
          position: fixed;
          width: 14px;
          height: 14px;
          background: #333;
          border: none;
          border-radius: 2px;
          cursor: pointer;
          z-index: 100001;
          opacity: 0.6;
          transition: opacity 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .crisp-hide-button::before {
          content: "×";
          color: #999;
          font-size: 12px;
          line-height: 1;
        }
        .crisp-hide-button:hover {
          opacity: 1;
        }
        .crisp-hide-button:hover::before {
          color: #fff;
        }
        /* Thin black bar when hidden - shows at left edge */
        .crisp-unhide-bar {
          position: fixed;
          width: 4px;
          height: 50px;
          background: #000;
          border-radius: 0 3px 3px 0;
          cursor: pointer;
          z-index: 100001;
          opacity: 0.5;
          transition: all 0.2s;
          display: none;
        }
        .crisp-unhide-bar:hover {
          opacity: 1;
          width: 8px;
          background: #333;
        }
        /* Force hide Crisp button when hidden class is applied */
        .crisp-client.crisp-hidden [role="button"],
        .crisp-client.crisp-hidden .cc-1m2mf {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        /* Prevent body/html from scrolling */
        html {
          position: fixed !important;
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
          top: 0 !important;
          left: 0 !important;
        }
        body {
          position: fixed !important;
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
          top: 0 !important;
          left: 0 !important;
        }
        /* Allow app to scroll internally */
        #root {
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
        }

        /* HACK: Hide "Compose your reply" and replace with custom text */
        .crisp-client span[data-for-id="new_messages"] {
          visibility: hidden !important;
          position: relative !important;
        }
        .crisp-client span[data-for-id="new_messages"]::before {
          content: "How do I run a workflow?" !important;
          visibility: visible !important;
          position: absolute !important;
          left: 0 !important;
          font-size: 12px !important;
          color: #fff !important;
        }
        /* Hide the extra span element (icon) */
        .crisp-client span.cc-1oz0d,
        .crisp-client span.cc-qdda2,
        .crisp-client .cc-1oz0d,
        .crisp-client .cc-qdda2 {
          display: none !important;
        }
        /* Make compose box wider to fit question */
        .crisp-client .cc-1xry,
        .crisp-client [data-for-id="new_messages"] {
          min-width: 180px !important;
        }
      `;
      document.head.appendChild(baseStyle);

      // Initialize Crisp
      window.$crisp = [];
      window.CRISP_WEBSITE_ID = websiteId;

      const script = document.createElement("script");
      script.src = "https://client.crisp.chat/l.js";
      script.async = true;
      script.onerror = function () {
        console.warn("Crisp chat failed to load, but continuing...");
      };
      document.head.appendChild(script);

      // Aggressive scroll prevention
      const preventScroll = () => {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
          console.log("⚠️ Window scroll detected, resetting to 0,0");
          window.scrollTo(0, 0);
        }
        if (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0) {
          console.log("⚠️ Document scroll detected, resetting to 0,0");
          document.documentElement.scrollTop = 0;
          document.documentElement.scrollLeft = 0;
        }
        if (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0) {
          console.log("⚠️ Body scroll detected, resetting to 0,0");
          document.body.scrollTop = 0;
          document.body.scrollLeft = 0;
        }
      };

      // Monitor for scroll attempts continuously
      const scrollHandler = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        preventScroll();
      };

      // Add listeners with capture phase
      window.addEventListener("scroll", scrollHandler, { passive: false, capture: true });
      document.addEventListener("scroll", scrollHandler, { passive: false, capture: true });
      document.body.addEventListener("scroll", scrollHandler, { passive: false, capture: true });

      // Also run preventScroll on a timer to catch any delayed scrolling
      const scrollCheckInterval = setInterval(() => {
        preventScroll();
      }, 100);

      // Track current position (mutable)
      let currentPos = getSavedPosition();
      let isDragging = false;
      let isCrispHidden = localStorage.getItem(CRISP_HIDDEN) === "true";

      // Wait for Crisp to load
      const observer = new MutationObserver(mutations => {
        const crispClient = document.querySelector(".crisp-client") as HTMLElement;
        if (crispClient) {
          // Prevent any scroll that might happen when Crisp loads
          preventScroll();

          // Force position with inline styles using current position
          const applyPosition = (element: HTMLElement) => {
            element.style.setProperty("bottom", `${currentPos.bottom}px`, "important");
            element.style.setProperty("left", `${currentPos.left}px`, "important");
            element.style.setProperty("right", "auto", "important");
            element.style.setProperty("position", "fixed", "important");
          };

          // Update CSS variables for dynamic positioning
          const updateCSSVars = () => {
            document.documentElement.style.setProperty("--crisp-left", `${currentPos.left}px`);
            document.documentElement.style.setProperty("--crisp-bottom", `${currentPos.bottom}px`);
          };

          // Apply to main element
          applyPosition(crispClient);
          updateCSSVars();

          // Also apply to all child divs that might be positioned
          const childDivs = crispClient.querySelectorAll("div");
          childDivs.forEach(div => {
            const htmlDiv = div as HTMLElement;
            const computedStyle = window.getComputedStyle(htmlDiv);
            if (computedStyle.position === "fixed" || computedStyle.position === "absolute" || htmlDiv.style.bottom) {
              applyPosition(htmlDiv);
            }
          });

          // Add drag handle to Crisp button - OUTSIDE Crisp's DOM to avoid style conflicts
          const addDragHandle = () => {
            if (document.querySelector(".crisp-drag-handle")) return; // Already added

            const crispButton = crispClient.querySelector('[role="button"]') as HTMLElement;
            if (!crispButton) return;

            const handle = document.createElement("div");
            handle.className = "crisp-drag-handle";
            handle.title = "Drag to move";

            // Append to body (outside Crisp's DOM) to avoid Crisp style conflicts
            document.body.appendChild(handle);

            // Position handle UNDER the Crisp button - re-query button each time to handle re-renders
            let lastBtnFound = true;
            const positionHandle = () => {
              // Skip positioning if hidden
              if (isCrispHidden) return;

              // Check if handle was removed from DOM (Crisp might remove it)
              if (!document.body.contains(handle)) {
                console.log("[CrispDrag] Handle was removed from DOM! Re-adding...");
                document.body.appendChild(handle);
              }

              // Try multiple selectors - Crisp changes structure on state change
              // Filter for buttons at BOTTOM of screen AND closest to saved position
              const allButtons = document.querySelectorAll('.crisp-client [role="button"]');
              let btn: HTMLElement | null = null;
              let bestDistance = Infinity;

              for (const b of allButtons) {
                const r = (b as HTMLElement).getBoundingClientRect();
                // Only accept buttons in bottom half of screen (chat icon, not header)
                if (r.top > window.innerHeight / 2) {
                  // Prefer button closest to our saved left position
                  const distFromSaved = Math.abs(r.left - currentPos.left);
                  if (distFromSaved < bestDistance) {
                    bestDistance = distFromSaved;
                    btn = b as HTMLElement;
                  }
                }
              }
              // Fallback to other selectors if no bottom button found
              if (!btn) {
                btn = (document.querySelector(".crisp-client .cc-1m2mf") ||
                  document.querySelector(".crisp-client [data-id]")) as HTMLElement;
              }

              if (!btn) {
                if (lastBtnFound) {
                  console.log(
                    "[CrispDrag] Button NOT found, hiding handle. Crisp DOM:",
                    document.querySelector(".crisp-client")?.innerHTML?.slice(0, 200)
                  );
                  lastBtnFound = false;
                }
                handle.style.display = "none";
                return;
              }

              if (!lastBtnFound) {
                console.log("[CrispDrag] Button FOUND again:", btn.className, btn.getAttribute("role"));
                lastBtnFound = true;
              }

              handle.style.display = "flex";
              const rect = btn.getBoundingClientRect();

              // Debug: log position if it changes significantly
              const newLeft = rect.left + rect.width / 2 - 14;
              const newTop = rect.bottom + 2;
              const prevLeft = parseFloat(handle.style.left) || 0;
              const prevTop = parseFloat(handle.style.top) || 0;
              if (Math.abs(newLeft - prevLeft) > 50 || Math.abs(newTop - prevTop) > 50) {
                console.log("[CrispDrag] Position changed significantly:", {
                  from: { left: prevLeft, top: prevTop },
                  to: { left: newLeft, top: newTop },
                  btnRect: {
                    left: rect.left,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                  },
                });
              }

              handle.style.position = "fixed";
              handle.style.left = `${newLeft}px`;
              handle.style.top = `${newTop}px`;
              handle.style.zIndex = "100001";
            };

            positionHandle();
            // Update handle position periodically (Crisp re-renders on message close)
            setInterval(positionHandle, 200);

            console.log("[CrispDrag] Drag handle added to body, positioned under Crisp button");

            // Drag state
            let dragStartX = 0;
            let dragStartY = 0;
            let startLeft = 0;
            let startBottom = 0;

            const onMouseDown = (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              isDragging = true;
              dragStartX = e.clientX;
              dragStartY = e.clientY;
              startLeft = currentPos.left;
              startBottom = currentPos.bottom;
              handle.style.cursor = "grabbing";
              console.log("[CrispDrag] Drag started at", { x: dragStartX, y: dragStartY });

              document.addEventListener("mousemove", onMouseMove);
              document.addEventListener("mouseup", onMouseUp);
            };

            const onMouseMove = (e: MouseEvent) => {
              if (!isDragging) return;

              const deltaX = e.clientX - dragStartX;
              const deltaY = dragStartY - e.clientY; // Inverted because bottom increases upward

              // Calculate new position
              let newLeft = startLeft + deltaX;
              let newBottom = startBottom + deltaY;

              // Bounds checking - re-query button for current dimensions
              const btn = document.querySelector('.crisp-client [role="button"]') as HTMLElement;
              const buttonWidth = btn?.getBoundingClientRect().width || 60;
              const buttonHeight = btn?.getBoundingClientRect().height || 60;

              // Clamp to viewport
              const maxLeft = window.innerWidth - buttonWidth - 10;
              const maxBottom = window.innerHeight - buttonHeight - 20; // Account for handle

              newLeft = Math.max(0, Math.min(newLeft, maxLeft));
              newBottom = Math.max(0, Math.min(newBottom, maxBottom));

              // Update position
              currentPos.left = newLeft;
              currentPos.bottom = newBottom;

              // Apply immediately
              applyPosition(crispClient);
              updateCSSVars();
              childDivs.forEach(div => {
                const htmlDiv = div as HTMLElement;
                const computedStyle = window.getComputedStyle(htmlDiv);
                if (
                  computedStyle.position === "fixed" ||
                  computedStyle.position === "absolute" ||
                  htmlDiv.style.bottom
                ) {
                  applyPosition(htmlDiv);
                }
              });
            };

            const onMouseUp = () => {
              if (!isDragging) return;
              isDragging = false;
              handle.style.cursor = "grab";
              console.log("[CrispDrag] Drag ended at", currentPos);

              // Save position to localStorage
              savePosition(currentPos.left, currentPos.bottom);

              document.removeEventListener("mousemove", onMouseMove);
              document.removeEventListener("mouseup", onMouseUp);
            };

            handle.addEventListener("mousedown", onMouseDown);

            // === HIDE/UNHIDE FUNCTIONALITY ===
            console.log("[CrispHide] Setting up hide/unhide functionality");

            // Create hide button (dark grey, right of drag handle)
            const hideButton = document.createElement("div");
            hideButton.className = "crisp-hide-button";
            hideButton.title = "Hide chat";
            document.body.appendChild(hideButton);

            // Create unhide bar (thin black bar at edge)
            const unhideBar = document.createElement("div");
            unhideBar.className = "crisp-unhide-bar";
            unhideBar.title = "Show chat";
            document.body.appendChild(unhideBar);

            // Position hide button to the right of drag handle
            const positionHideButton = () => {
              const handleRect = handle.getBoundingClientRect();
              if (handleRect.width === 0) return; // Handle not visible
              hideButton.style.left = `${handleRect.right + 4}px`;
              hideButton.style.top = `${handleRect.top}px`;
            };

            // Position unhide bar at left edge, same height as icon
            const positionUnhideBar = () => {
              unhideBar.style.left = "0px";
              unhideBar.style.bottom = `${currentPos.bottom}px`;
            };

            // Position immediately and then periodically
            positionHideButton();
            positionUnhideBar();
            setInterval(() => {
              positionHideButton();
              positionUnhideBar();
            }, 200);
            console.log("[CrispHide] Hide button created and positioned");

            // Hide/show functions
            const hideCrisp = () => {
              console.log("[CrispHide] Hiding Crisp button");
              isCrispHidden = true;
              // Add hidden class to crisp-client (CSS handles hiding button with !important)
              const crispEl = document.querySelector(".crisp-client");
              if (crispEl) crispEl.classList.add("crisp-hidden");
              // Hide drag handle and hide button
              handle.style.display = "none";
              hideButton.style.display = "none";
              // Show unhide bar
              unhideBar.style.display = "block";
              positionUnhideBar();
              // Save state
              localStorage.setItem(CRISP_HIDDEN, "true");
            };

            const showCrisp = () => {
              console.log("[CrispHide] Showing Crisp button");
              isCrispHidden = false;
              // Remove hidden class from crisp-client
              const crispEl = document.querySelector(".crisp-client");
              if (crispEl) crispEl.classList.remove("crisp-hidden");
              // Show drag handle and hide button
              handle.style.display = "flex";
              hideButton.style.display = "block";
              // Hide unhide bar
              unhideBar.style.display = "none";
              // Save state
              localStorage.setItem(CRISP_HIDDEN, "false");
            };

            // Click handlers
            hideButton.addEventListener("click", e => {
              e.preventDefault();
              e.stopPropagation();
              hideCrisp();
            });

            unhideBar.addEventListener("click", e => {
              e.preventDefault();
              e.stopPropagation();
              showCrisp();
            });

            // Restore hidden state from localStorage (isCrispHidden already set at top)
            if (isCrispHidden) {
              console.log("[CrispHide] Restoring hidden state from localStorage");
              // Delay slightly to ensure Crisp button exists
              setTimeout(hideCrisp, 100);
            }
          };

          // Try to add handle now and retry if button not ready
          addDragHandle();
          const handleRetry = setInterval(() => {
            if (document.querySelector(".crisp-drag-handle")) {
              clearInterval(handleRetry);
              return;
            }
            addDragHandle();
          }, 500);

          // Clear retry after 10 seconds
          setTimeout(() => clearInterval(handleRetry), 10000);

          // Keep monitoring for style changes that Crisp might make
          const styleObserver = new MutationObserver(() => {
            if (!isDragging) {
              // Don't fight with drag
              applyPosition(crispClient);
            }
          });

          styleObserver.observe(crispClient, {
            attributes: true,
            attributeFilter: ["style"],
          });

          // Force position on an interval (but respect dragging)
          const positionInterval = setInterval(() => {
            if (isDragging) return; // Don't interfere with drag

            const crisp = document.querySelector(".crisp-client") as HTMLElement;
            if (crisp) {
              applyPosition(crisp);
              // Also check all child divs
              const childDivs = crisp.querySelectorAll("div");
              childDivs.forEach(div => {
                const htmlDiv = div as HTMLElement;
                const computedStyle = window.getComputedStyle(htmlDiv);
                if (
                  computedStyle.position === "fixed" ||
                  computedStyle.position === "absolute" ||
                  htmlDiv.style.bottom
                ) {
                  applyPosition(htmlDiv);
                }
              });
            }
          }, 100);

          // Stop observing once Crisp is found
          observer.disconnect();
        }
      });

      // Start observing body for Crisp insertion
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Configuration script
      const configScript = document.createElement("script");
      configScript.innerHTML = `
        try {
          // Black & White minimalist theme (official Crisp config)
          if (window.$crisp) {
            window.$crisp.push(["config", "color:theme", ["black"]]);
            window.$crisp.push(["config", "position:reverse", [true]]); // Position on left side

            // Show preview message after Crisp loads - ONLY ONCE per browser session
            window.$crisp.push(["on", "session:loaded", function() {
              // Use localStorage for persistent tracking across page navigations
              if (!localStorage.getItem('crisp_preview_shown')) {
                console.log('🎯 Scheduling Crisp preview message (first time only)');
                setTimeout(function() {
                  window.$crisp.push(["do", "message:show", ["text", "Founder is here, chat with me"]]);
                  localStorage.setItem('crisp_preview_shown', 'true');
                  console.log('✅ Crisp preview message shown');
                }, 10000);
              } else {
                console.log('⏭️ Crisp preview already shown, skipping');
              }
            }]);

            // Add more event listeners to debug
            window.$crisp.push(["on", "chat:opened", function() {
              console.log("🟢 Chat window OPENED");
            }]);

            window.$crisp.push(["on", "chat:closed", function() {
              console.log("🔴 Chat window CLOSED");
            }]);

            window.$crisp.push(["on", "message:received", function(data) {
              console.log("🟢 Message received:", data);

              // Only handle text messages from operator via network (not history/local)
              if (data.origin === "network" && data.type === "text" && data.from === "operator") {
                console.log("🟢 Operator message detected, showing bubble + picker");

                // Show the operator's message as a bubble
                window.$crisp.push(["do", "message:show", ["text", data.content]]);

                // Show picker with quick reply options after a short delay
                setTimeout(function() {
                  window.$crisp.push(["do", "message:show", ["picker", {
                    "id": "quick-reply",
                    "text": "Quick replies:",
                    "choices": [
                      { "value": "what-is-this", "label": "What is this app?", "selected": false },
                      { "value": "not-working", "label": "The app doesn't work!", "selected": false },
                      { "value": "how-to-run", "label": "How do I run a workflow?", "selected": false }
                    ]
                  }]]);
                  console.log("🟢 Picker shown");
                }, 500);
              }
            }]);
          } else {
            console.warn("🔴 $crisp not found in config script");
          }

          // Helper function: Show preview message bubble next to chat button
          window.crispShowPreview = function(message) {
            if (window.$crisp) {
              // Show a message in the chat (creates preview bubble + unread badge)
              window.$crisp.push(["do", "message:show", ["text", message]]);
              console.log("Crisp preview shown:", message);
            }
          };

          // Helper function: Trigger attention animation on chat button
          window.crispTriggerAttention = function() {
            if (window.$crisp) {
              // Open and close quickly to trigger attention (creates a "pulse" effect)
              var chatButton = document.querySelector('.crisp-client [role="button"]');
              if (chatButton) {
                // Add CSS animation class
                chatButton.style.animation = 'crisp-pulse 2s ease-in-out';
                setTimeout(function() {
                  chatButton.style.animation = '';
                }, 2000);
              }
            }
          };

          // Define pulse animation
          var style = document.createElement('style');
          style.innerHTML = \`
            @keyframes crisp-pulse {
              0%, 100% { transform: scale(1); }
              25% { transform: scale(1.1); }
              50% { transform: scale(1); }
              75% { transform: scale(1.1); }
            }
          \`;
          document.head.appendChild(style);
        } catch (error) {
          console.warn('Crisp config error (suppressed):', error);
        }
      `;
      document.head.appendChild(configScript);

      // No cleanup function - we want Crisp to persist across component remounts
      // This prevents re-initialization on page navigation
    } catch (error) {
      console.warn("Crisp initialization error (suppressed):", error);
      // Reset flag on error so initialization can be retried
      crispInitialized = false;
    }
  }, [websiteId]);

  return null;
}
