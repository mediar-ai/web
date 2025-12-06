'use client';

import { useUser } from '@clerk/nextjs';
import Script from 'next/script';
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    $crisp: any;
    CRISP_WEBSITE_ID: string;
    // Helper functions for Crisp customization
    crispShowPreview?: (message: string) => void;
    crispTriggerAttention?: () => void;
  }
}

export function CrispChat() {
  const { user } = useUser();
  const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
  const [isInIframe, setIsInIframe] = useState(false);

  // Detect if we're inside an iframe
  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      // If accessing window.top throws (cross-origin), we're in an iframe
      setIsInIframe(true);
    }
  }, []);

  // Suppress Crisp errors globally
  useEffect(() => {
    const originalError = console.error;
    const handleError = (event: ErrorEvent) => {
      if (event.message && event.message.includes('Invalid data')) {
        event.preventDefault();
        console.warn('Crisp error suppressed:', event.message);
        return true;
      }
    };

    window.addEventListener('error', handleError);

    // Suppress console errors from Crisp
    console.error = (...args: any[]) => {
      const errorString = args.join(' ');
      if (errorString.includes('Invalid data') || errorString.includes('crisp')) {
        console.warn('Crisp console error suppressed:', ...args);
        return;
      }
      originalError.apply(console, args);
    };

    return () => {
      window.removeEventListener('error', handleError);
      console.error = originalError;
    };
  }, []);

  // Set user data when logged in
  useEffect(() => {
    if (!websiteId) return;
    if (user && window.$crisp) {
      window.$crisp.push(['set', 'user:email', [user.emailAddresses[0]?.emailAddress]]);
      window.$crisp.push(['set', 'user:nickname', [
        user.fullName || user.username || user.firstName || 'User'
      ]]);
      window.$crisp.push(['set', 'session:data', [[
        ['user_id', user.id],
        ['created_at', user.createdAt ? new Date(user.createdAt).toISOString() : ''],
      ]]]);
    }
  }, [user, websiteId]);

  // Handle logout - reset Crisp session
  useEffect(() => {
    if (!websiteId) return;
    if (!user && window.$crisp) {
      window.$crisp.push(['do', 'session:reset']);
    }
  }, [user, websiteId]);

  // Don't load Crisp if not configured or if we're in an iframe
  if (!websiteId) {
    console.warn('NEXT_PUBLIC_CRISP_WEBSITE_ID is not set');
    return null;
  }

  if (isInIframe) {
    return null;
  }

  return (
    <>
      <Script
        id="crisp-widget"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            try {
              window.$crisp = [];
              window.CRISP_WEBSITE_ID = "${websiteId}";
              (function(){
                var d = document;
                var s = d.createElement("script");
                s.src = "https://client.crisp.chat/l.js";
                s.async = 1;
                s.onerror = function() {
                  console.warn('Crisp chat failed to load, but continuing...');
                };
                d.getElementsByTagName("head")[0].appendChild(s);
              })();
            } catch (error) {
              console.warn('Crisp initialization error (suppressed):', error);
            }
          `,
        }}
      />
      <Script
        id="crisp-config"
        strategy="afterInteractive"
      >
        {`
          try {
            // Black & White minimalist theme (official Crisp config)
            if (window.$crisp) {
              window.$crisp.push(["config", "color:theme", ["black"]]);
              window.$crisp.push(["config", "position:reverse", [false]]);

              // Show preview message after Crisp loads
              window.$crisp.push(["on", "session:loaded", function() {
                console.log("Crisp session loaded!");

                // Check if preview was already shown
                if (!sessionStorage.getItem('crisp_preview_shown')) {
                  console.log("Showing preview message in 10 seconds...");
                  setTimeout(function() {
                    window.$crisp.push(["do", "message:show", ["text", "Founder is here, chat with me"]]);
                    sessionStorage.setItem('crisp_preview_shown', 'true');
                  }, 10000);
                } else {
                  console.log("Preview already shown this session");
                }
              }]);
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
        `}
      </Script>
    </>
  );
}
