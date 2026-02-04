"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";

const ChatGPTIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1685a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4092-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
  </svg>
);

const ClaudeIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="currentColor">
    <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z" />
  </svg>
);

const PerplexityIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" />
  </svg>
);

export default function AskAI() {
  const posthog = usePostHog();

  const handleAskClick = (provider: string, url: string) => {
    posthog?.capture("ask_ai_clicked", {
      provider,
      url,
      source: "homepage",
    });
  };

  const query = encodeURIComponent(
    "What is Screenpipe (screenpi.pe)? Give me 10 concrete ideas of what I can do with it and how it can help me be more productive. How does it compare to alternatives like Rewind, Recall, or Microsoft Recall? Be objective but consider that Screenpipe is open source, local-first, and has an extensible plugin system. What makes it unique?"
  );

  const providers = [
    {
      name: "ChatGPT",
      url: `https://chat.openai.com/?q=${query}`,
      icon: ChatGPTIcon,
    },
    {
      name: "Claude",
      url: `https://claude.ai/new?q=${query}`,
      icon: ClaudeIcon,
    },
    {
      name: "Perplexity",
      url: `https://www.perplexity.ai/?q=${query}`,
      icon: PerplexityIcon,
    },
  ];

  return (
    <div className="max-w-5xl w-full mt-8">
      <div className="relative bg-gray-50 rounded-2xl border-2 border-black p-8 md:p-12 overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-black font-mono mb-4">
            STILL NOT SURE THAT SCREENPIPE IS RIGHT FOR YOU?
          </h2>
          <p className="text-gray-600 mb-8 text-base md:text-lg">
            Let ChatGPT, Claude, or Perplexity do the thinking for you.
            <br />
            Click a button and see what your favorite AI says about Screenpipe.
          </p>
          <div className="flex flex-wrap gap-3">
            {providers.map((provider) => (
              <Button
                key={provider.name}
                variant="black-outline"
                asChild
                onClick={() => handleAskClick(provider.name, provider.url)}
              >
                <Link
                  href={provider.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <provider.icon className="w-4 h-4 mr-2" />
                  Ask {provider.name}
                </Link>
              </Button>
            ))}
          </div>
        </div>

        {/* Decorative illustration */}
        <div className="hidden md:block absolute right-4 bottom-4 w-40 h-40 lg:w-52 lg:h-52">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <ellipse cx="140" cy="180" rx="40" ry="10" fill="#e5e5e5" />
            <path
              d="M120 180 L120 120 Q120 100 140 100 Q160 100 160 120 L160 180"
              fill="#1a1a1a"
            />
            <circle cx="140" cy="85" r="25" fill="#e5e5e5" />
            <path
              d="M115 85 Q110 60 130 55 Q150 50 165 70 Q170 85 165 95 Q160 85 155 80 Q145 75 135 78 Q125 80 120 90 Q115 95 115 85"
              fill="#1a1a1a"
            />
            <path
              d="M160 120 Q180 90 175 60"
              stroke="#1a1a1a"
              strokeWidth="12"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="175" cy="55" r="8" fill="#e5e5e5" />
            <circle
              cx="185"
              cy="35"
              r="18"
              stroke="#1a1a1a"
              strokeWidth="4"
              fill="none"
            />
            <line
              x1="172"
              y1="48"
              x2="162"
              y2="58"
              stroke="#1a1a1a"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <ellipse
              cx="175"
              cy="100"
              rx="20"
              ry="15"
              fill="#e5e5e5"
              stroke="#1a1a1a"
              strokeWidth="2"
            />
            <path
              d="M160 105 L155 115 L165 108"
              fill="#e5e5e5"
              stroke="#1a1a1a"
              strokeWidth="2"
            />
            <text
              x="175"
              y="104"
              textAnchor="middle"
              fontSize="12"
              fill="#1a1a1a"
            >
              ...
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
