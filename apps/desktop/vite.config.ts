import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const isDev = mode === "development";

  // Load .env files based on mode
  const env = loadEnv(mode, process.cwd(), "");

  // Define build-specific environment variables
  const envConfig = {
    "observer-local": {
      VITE_APP_VARIANT: "observer-local",
      VITE_FEATURES: "workflow-recording,ui",
      VITE_APP_NAME: "Mediar Observer",
    },
    "observer-remote": {
      VITE_APP_VARIANT: "observer-remote",
      VITE_FEATURES: "workflow-recording,ui,remote-dashboard,analytics",
      VITE_APP_NAME: "Mediar Observer Pro",
    },
    service: {
      VITE_APP_VARIANT: "service",
      VITE_FEATURES: "workflow-recording,remote-dashboard,analytics,stealth-mode",
      VITE_APP_NAME: "Mediar Service",
    },
    full: {
      VITE_APP_VARIANT: "full",
      VITE_FEATURES: "ui,chat,form-filling,analytics,tray-icon",
      VITE_APP_NAME: "Mediar",
    },
  };

  const currentConfig = envConfig[mode as keyof typeof envConfig] || envConfig.full;

  // Conditionally import Sentry plugin only for production builds
  let sentryPlugin = [];
  if (!isDev) {
    try {
      const { sentryVitePlugin } = await import("@sentry/vite-plugin");

      // Use the same DSN as hardcoded in Rust
      const SENTRY_DSN =
        "https://20fa578ce8cbc60334a19a9f8909419c@o4507617161314304.ingest.us.sentry.io/4509487006220288";

      // Extract org and project from DSN
      const dsnMatch = SENTRY_DSN.match(/o(\d+)\.ingest\.us\.sentry\.io\/(\d+)/);
      const orgId = dsnMatch ? dsnMatch[1] : null;
      const projectId = dsnMatch ? dsnMatch[2] : null;

      if (orgId && projectId) {
        sentryPlugin = [
          sentryVitePlugin({
            org: orgId,
            project: projectId,
            authToken: process.env.SENTRY_AUTH_TOKEN, // Optional - will warn if not provided
            sourcemaps: {
              assets: "./dist/**",
              ignore: ["node_modules/**"],
            },
            release: {
              name: process.env.npm_package_version || "1.0.0",
            },
            telemetry: false, // Disable telemetry to reduce warnings
          }),
        ];
        console.log("Sentry plugin configured with extracted org/project from DSN");
      } else {
        console.warn("Could not extract org/project from Sentry DSN");
      }
    } catch (error) {
      console.warn("Sentry Vite plugin not available, skipping source map upload");
    }
  }

  return {
    plugins: [react(), ...sentryPlugin],

    define: {
      ...Object.entries(currentConfig).reduce(
        (acc, [key, value]) => {
          acc[`process.env.${key}`] = JSON.stringify(value);
          return acc;
        },
        {} as Record<string, string>
      ),
      // Pass through VITE_* env vars from .env files
      "import.meta.env.VITE_CRISP_WEBSITE_ID": JSON.stringify(env.VITE_CRISP_WEBSITE_ID),
    },

    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: parseInt(process.env.VITE_PORT || process.env.PORT || "1420"),
      strictPort: false, // Allow Vite to find another port if needed
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },

    build: {
      // Tauri uses Chromium on Windows and WebKit on macOS and Linux
      target: ["es2021", process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13"],
      // don't minify for debug builds
      minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
      // produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      // Add different build outputs based on mode
      outDir: mode === "service" ? "dist-service" : "dist",
      chunkSizeWarningLimit: 1500, // Increased to reduce false positives
      rollupOptions: {
        output: {
          manualChunks: {
            // Core React vendor bundle
            "react-vendor": ["react", "react-dom"],

            // Tauri API bundle (frequently used together)
            "tauri-vendor": ["@tauri-apps/api/core", "@tauri-apps/api/window", "@tauri-apps/api/event"],

            // UI component library bundle
            "ui-vendor": [
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-tabs",
              "@radix-ui/react-tooltip",
              "@radix-ui/react-scroll-area",
            ],

            // Markdown rendering bundle (large - isolate for better caching)
            markdown: ["react-markdown", "remark-gfm", "remark-breaks", "react-syntax-highlighter"],

            // Analytics bundle
            "analytics-vendor": ["posthog-js"],

            // Lucide icons (used extensively)
            "icons-vendor": ["lucide-react"],

            // Utility libraries
            "utils-vendor": ["sonner", "yaml"],
          },
        },
      },
    },
  };
});
