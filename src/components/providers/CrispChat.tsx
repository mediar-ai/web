"use client";

import Script from "next/script";
import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

declare global {
  interface Window {
    $crisp: any;
    CRISP_WEBSITE_ID: string;
    crispShowPreview?: (message: string) => void;
    crispTriggerAttention?: () => void;
  }
}

export function CrispChat() {
  const { user } = useUser();
  const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;

  useEffect(() => {
    if (window.$crisp && user) {
      if (user.primaryEmailAddress?.emailAddress) {
        window.$crisp.push([
          "set",
          "user:email",
          [user.primaryEmailAddress.emailAddress],
        ]);
      }

      const nickname =
        user.fullName || user.username || user.firstName || "User";
      window.$crisp.push(["set", "user:nickname", [nickname]]);

      window.$crisp.push([
        "set",
        "session:data",
        [
          [
            ["user_id", user.id],
            [
              "created_at",
              user.createdAt ? new Date(user.createdAt).toISOString() : "",
            ],
          ],
        ],
      ]);
    }
  }, [user]);

  useEffect(() => {
    if (!user && window.$crisp) {
      window.$crisp.push(["do", "session:reset"]);
    }
  }, [user]);

  if (!websiteId) {
    console.warn("Crisp Chat: NEXT_PUBLIC_CRISP_WEBSITE_ID is not defined");
    return null;
  }

  return (
    <>
      <Script
        id="crisp-widget"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.$crisp = [];
            window.CRISP_WEBSITE_ID = "${websiteId}";
            (function() {
              var d = document;
              var s = d.createElement("script");
              s.src = "https://client.crisp.chat/l.js";
              s.async = 1;
              d.getElementsByTagName("head")[0].appendChild(s);
            })();
          `,
        }}
      />
      <Script id="crisp-config" strategy="afterInteractive">
        {`
          window.$crisp.push(["config", "color:theme", ["black"]]);
          window.$crisp.push(["config", "position:reverse", [false]]);

          window.$crisp.push(["on", "session:loaded", function() {
            console.log("Crisp session loaded!");
            if (!sessionStorage.getItem('crisp_preview_shown')) {
              console.log("Showing preview message...");
              setTimeout(function() {
                window.$crisp.push(["do", "message:show", ["text", "Founder is here, chat with me"]]);
                sessionStorage.setItem('crisp_preview_shown', 'true');
              }, 2000);
            } else {
              console.log("Preview already shown this session");
            }
          }]);

          window.crispShowPreview = function(message) {
            if (window.$crisp) {
              window.$crisp.push(["do", "message:show", ["text", message]]);
              console.log("Crisp preview shown:", message);
            }
          };

          window.crispTriggerAttention = function() {
            if (window.$crisp) {
              var chatButton = document.querySelector('.crisp-client [role="button"]');
              if (chatButton) {
                chatButton.style.animation = 'crisp-pulse 2s ease-in-out';
                setTimeout(function() {
                  chatButton.style.animation = '';
                }, 2000);
              }
            }
          };

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
        `}
      </Script>
    </>
  );
}
