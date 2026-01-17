use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use tokio::time::sleep;

// Global MCP server instance - auto-managed
static MCP_SERVER: Lazy<Arc<Mutex<McpServerManager>>> = Lazy::new(|| Arc::new(Mutex::new(McpServerManager::new())));

/// Create a reqwest client that bypasses system proxy for localhost connections.
/// This fixes issues where VPN/proxy software intercepts localhost traffic without proper bypass rules.
pub fn localhost_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy() // Bypass all proxy settings for this client
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub struct McpServerManager {
    port: u16,
    is_running: Arc<AtomicBool>,
    is_ready: Arc<AtomicBool>,           // Only true when /mcp endpoint is fully initialized
    is_restarting: Arc<AtomicBool>,      // Prevents concurrent restart attempts
    is_tool_executing: Arc<AtomicBool>,  // Skip health checks during tool execution
    start_time: Option<Instant>,
    auto_restart_enabled: bool,
    process_pid: Option<u32>,
    consecutive_failures: u32,
    restart_count: u32,
    last_error: Option<String>,
}

impl Default for McpServerManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpServerManager {
    pub fn new() -> Self {
        Self {
            port: 0,
            is_running: Arc::new(AtomicBool::new(false)),
            is_ready: Arc::new(AtomicBool::new(false)),
            is_restarting: Arc::new(AtomicBool::new(false)),
            is_tool_executing: Arc::new(AtomicBool::new(false)),
            start_time: None,
            auto_restart_enabled: true,
            process_pid: None,
            consecutive_failures: 0,
            restart_count: 0,
            last_error: None,
        }
    }

    /// Auto-start the MCP server and maintain it
    pub async fn ensure_running(&mut self, app_handle: tauri::AppHandle) -> Result<u16, String> {
        // If already running and healthy, return current port
        if self.is_running.load(Ordering::Relaxed) && self.is_healthy().await {
            return Ok(self.port);
        }

        // Track restart attempt
        self.restart_count += 1;

        // Detect crash loop (more than 5 restarts)
        if self.restart_count > 5 {
            let error_msg = format!(
                "MCP server crash loop detected: {} restart attempts. Last error: {:?}",
                self.restart_count, self.last_error
            );
            error!("{}", error_msg);

            return Err(error_msg);
        }

        // Kill only orphaned or conflicting processes (smart PID-based cleanup)
        Self::kill_orphaned_or_conflicting_processes().await;

        // Find available port
        let port = Self::find_available_port().await?;
        self.port = port;

        info!(
            "🚀 Starting MCP server on port {} using bundled binary (hidden)",
            port
        );

        // Get the bundled MCP binary path (sidecar automatically hides console window)
        // Tauri automatically adds platform suffix, so we use the generic name
        let sidecar_name = "terminator-mcp-agent";

        let mcp_command = match app_handle.shell().sidecar(sidecar_name) {
            Ok(command) => {
                info!(
                    "✅ Found MCP sidecar binary: {} (Tauri will use platform-specific binary)",
                    sidecar_name
                );
                command
            }
            Err(e) => {
                error!(
                    "❌ Failed to get bundled MCP binary '{}': {}",
                    sidecar_name, e
                );
                error!("❌ MCP binary not found. Tauri looks for platform-specific binaries in src-tauri/binaries/");
                #[cfg(target_os = "windows")]
                {
                    #[cfg(target_arch = "x86_64")]
                    error!("❌ On Windows x64, it expects: terminator-mcp-agent-x86_64-pc-windows-msvc.exe");
                    #[cfg(target_arch = "aarch64")]
                    error!("❌ On Windows ARM64, it expects: terminator-mcp-agent-aarch64-pc-windows-msvc.exe");
                }
                error!("❌ Please ensure the correct binary exists in src-tauri/binaries/");
                return Err(format!("MCP binary not found '{sidecar_name}': {e}"));
            }
        };

        // Start the server process using bundled MCP binary
        // Note: Tauri sidecar system automatically hides console windows on Windows
        // Pass --watch-pid so MCP server auto-terminates if this app dies
        // BUT: In dev mode, don't use watch-pid because it causes immediate shutdown
        let current_pid = std::process::id();

        let mut args_vec = vec![
            "--transport".to_string(),
            "http".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--cors".to_string(),
        ];

        // Production mode: enforce single instance and add watch-pid
        if !cfg!(debug_assertions) {
            args_vec.push("--watch-pid".to_string());
            args_vec.push(current_pid.to_string());
            args_vec.push("--enforce-single-instance".to_string());
            info!("🔒 PRODUCTION MODE: Enforcing single instance");
        } else {
            info!("🔧 DEV MODE: Skipping --watch-pid to prevent immediate shutdown");
            info!("🔧 DEV MODE: Allowing multiple instances (default behavior)");
        }

        // Set Sentry DSN for MCP error tracking (production only)
        // MCP_MAX_CONCURRENT=3 allows parallel tool calls from Claude Code
        let cmd = if !cfg!(debug_assertions) {
            mcp_command
                .args(args_vec)
                .env(
                    "SENTRY_DSN",
                    "https://67b4dc91ef2b2963f8f9f05180cf9da4@o4507617161314304.ingest.us.sentry.io/4510269450682368",
                )
                .env("SENTRY_ENVIRONMENT", "production")
                .env("MCP_MAX_CONCURRENT", "3")
        } else {
            mcp_command.args(args_vec).env("MCP_MAX_CONCURRENT", "3")
        };

        info!("🔄 Spawning MCP server process via Tauri sidecar (console window auto-hidden)...");
        match cmd.spawn() {
            Ok((mut rx, child)) => {
                // Capture the PID for tracking
                let child_pid = child.pid();
                self.process_pid = Some(child_pid);
                info!(
                    "✅ MCP server process spawned successfully with PID: {}",
                    child_pid
                );

                // Monitor logs in background
                tokio::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                info!("[MCP:{}] {}", port, String::from_utf8_lossy(&line));
                            }
                            tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                let line_str = String::from_utf8_lossy(&line);

                                // Parse the log level from terminator-mcp-agent's tracing output
                                // Format: "TIMESTAMP LEVEL target: message"
                                // Example: "2025-10-31T19:49:32.212733Z  INFO terminator_mcp_agent::scripting_engine: [Node.js] Starting..."
                                if let Some(level_start) = line_str
                                    .find(|c: char| c.is_ascii_uppercase() && line_str[..].contains("terminator"))
                                {
                                    let after_timestamp = &line_str[level_start..];

                                    // Extract log level and forward ALL logs without filtering (TRACE, DEBUG, INFO, WARN, ERROR)
                                    if after_timestamp.starts_with("ERROR") || after_timestamp.starts_with("FATAL") {
                                        error!("[MCP:{}] {}", port, line_str.trim());
                                    } else if after_timestamp.starts_with("WARN") {
                                        warn!("[MCP:{}] {}", port, line_str.trim());
                                    } else if after_timestamp.starts_with("INFO") {
                                        // Forward ALL INFO logs - no keyword filtering
                                        info!("[MCP:{}] {}", port, line_str.trim());
                                    } else if after_timestamp.starts_with("DEBUG") {
                                        // Forward DEBUG logs as info level for visibility
                                        info!("[MCP:{}] {}", port, line_str.trim());
                                    } else if after_timestamp.starts_with("TRACE") {
                                        // Forward TRACE logs as debug level (may be filtered by global log level)
                                        debug!("[MCP:{}] {}", port, line_str.trim());
                                    } else {
                                        // Fallback for unparseable lines - log at info level
                                        info!("[MCP:{}] {}", port, line_str.trim());
                                    }
                                } else {
                                    // Non-tracing output (startup messages, etc) - forward everything
                                    if line_str.contains("error")
                                        || line_str.contains("ERROR")
                                        || line_str.contains("failed")
                                    {
                                        error!("[MCP:{}] {}", port, line_str.trim());
                                    } else if line_str.contains("warn") || line_str.contains("WARN") {
                                        warn!("[MCP:{}] {}", port, line_str.trim());
                                    } else {
                                        info!("[MCP:{}] {}", port, line_str.trim());
                                    }
                                }
                            }
                            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                                error!("[MCP:{}] Process terminated: {:?}", port, payload);
                                break;
                            }
                            _ => {}
                        }
                    }
                });

                // Wait for server to start
                sleep(Duration::from_secs(3)).await;

                // Verify health
                if self.is_healthy().await {
                    info!("✅ MCP server started successfully on port {}", port);
                    self.is_running.store(true, Ordering::Relaxed);
                    self.start_time = Some(Instant::now());

                    // Don't check /mcp endpoint readiness at startup - let it be checked on-demand
                    // This allows the app to show immediately while Desktop initializes in the background
                    info!("🔄 MCP server running - Desktop will initialize on first /mcp request");
                    self.is_ready.store(false, Ordering::Relaxed);

                    // Reset counters on success
                    self.restart_count = 0;
                    self.last_error = None;

                    Ok(port)
                } else {
                    let error_msg = "Server started but failed health check".to_string();
                    warn!("⚠️ {}", error_msg);
                    self.last_error = Some(error_msg.clone());

                    let _ = child.kill();
                    Err(error_msg)
                }
            }
            Err(e) => {
                let error_msg = format!("Failed to start process: {e}");
                error!("❌ Failed to spawn MCP server: {}", e);
                self.last_error = Some(error_msg.clone());

                Err(error_msg)
            }
        }
    }

    /// Check if server is healthy via HTTP with retry logic
    ///
    /// NOTE: Retry delays are kept short (1s, 2s) to minimize lock hold time
    /// and prevent UI freezes. Total worst-case: ~3 seconds of retries.
    async fn is_healthy(&self) -> bool {
        // First attempt
        if self.is_healthy_single_attempt().await {
            return true;
        }

        warn!("⚠️ Health check failed on first attempt, retrying after 1 second...");
        sleep(Duration::from_secs(1)).await;

        // Second attempt
        if self.is_healthy_single_attempt().await {
            info!("✅ Health check passed on second attempt");
            return true;
        }

        warn!("⚠️ Health check failed on second attempt, retrying after 2 seconds...");
        sleep(Duration::from_secs(2)).await;

        // Third and final attempt
        let result = self.is_healthy_single_attempt().await;
        if result {
            info!("✅ Health check passed on third attempt");
        } else {
            let error_msg = "Health check failed after 3 attempts (backoff: 0s, 1s, 2s)";
            error!("❌ {}", error_msg);
        }
        result
    }

    /// Single health check attempt (no retry logic)
    async fn is_healthy_single_attempt(&self) -> bool {
        if self.port == 0 {
            info!("🔍 Health check failed: no port assigned");
            return false;
        }

        // Validate PID if available
        if let Some(pid) = self.process_pid {
            if !Self::is_process_alive(pid) {
                error!("❌ Health check failed: Process PID {} is not alive", pid);
                return false;
            }
        }

        // Get health check timeout from env var (default: 5 seconds)
        // Keep this short to prevent UI freezes when holding mutex
        // The retry logic handles transient failures
        let timeout_secs = std::env::var("MCP_HEALTH_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .map(|ms| ms / 1000)
            .unwrap_or(5);

        let url = format!("http://127.0.0.1:{}/health", self.port);
        debug!(
            "🔍 Health checking MCP server at: {} (timeout: {}s, PID: {:?})",
            url, timeout_secs, self.process_pid
        );

        // Use client that bypasses proxy - VPN/proxy software can intercept localhost without proper bypass rules
        let client = localhost_http_client();
        match tokio::time::timeout(Duration::from_secs(timeout_secs), client.get(&url).send()).await {
            Ok(Ok(response)) => {
                let status = response.status();
                let is_success = status.is_success();
                if is_success {
                    debug!(
                        "✅ Health check passed: {} {}",
                        status.as_u16(),
                        status.canonical_reason().unwrap_or("")
                    );
                } else {
                    warn!(
                        "⚠️ Health check failed: {} {}",
                        status.as_u16(),
                        status.canonical_reason().unwrap_or("")
                    );
                }
                is_success
            }
            Ok(Err(e)) => {
                warn!("⚠️ Health check request failed: {}", e);
                false
            }
            Err(_) => {
                warn!("⚠️ Health check timed out after {} seconds", timeout_secs);
                false
            }
        }
    }

    /// Check if /mcp endpoint is ready to accept connections
    /// This is separate from health check - the process can be healthy but /mcp not fully initialized
    async fn is_mcp_endpoint_ready(&self) -> bool {
        if self.port == 0 {
            return false;
        }

        let url = format!("http://127.0.0.1:{}/mcp", self.port);
        debug!("🔍 Checking /mcp endpoint readiness at: {}", url);

        // Try a simple POST request to /mcp (JSON-RPC initialize)
        // Use client that bypasses proxy for localhost connections
        let client = localhost_http_client();
        let init_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "mediar-readiness-check", "version": "1.0.0" }
            }
        });

        match tokio::time::timeout(
            Duration::from_secs(15), // Increased timeout to account for Desktop initialization (~10s)
            client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .json(&init_body)
                .send(),
        )
        .await
        {
            Ok(Ok(response)) => {
                let status = response.status();
                // Accept any response that's NOT 503 Service Unavailable
                // Even 400 Bad Request means Desktop is initialized, just our test request is malformed
                if status.as_u16() != 503 {
                    // info!("✅ /mcp endpoint is ready (status {})", status.as_u16());
                    true
                } else {
                    warn!("⚠️ /mcp endpoint still initializing (503)");
                    false
                }
            }
            Ok(Err(e)) => {
                warn!("⚠️ /mcp endpoint request failed: {}", e);
                false
            }
            Err(_) => {
                warn!("⚠️ /mcp endpoint check timed out after 15 seconds");
                false
            }
        }
    }

    /// Check if a process is alive by PID
    #[cfg(target_os = "windows")]
    fn is_process_alive(pid: u32) -> bool {
        use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

        unsafe {
            let process_handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(handle) => handle,
                Err(_) => return false,
            };

            if process_handle.is_invalid() {
                return false;
            }

            let mut exit_code: u32 = 0;
            let result = GetExitCodeProcess(process_handle, &mut exit_code);
            let _ = CloseHandle(process_handle);

            if result.is_err() {
                return false;
            }

            exit_code == STILL_ACTIVE.0 as u32
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn is_process_alive(pid: u32) -> bool {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        // Signal 0 doesn't send a signal, just checks if process exists
        kill(Pid::from_raw(pid as i32), Signal::from_c_int(0).unwrap()).is_ok()
    }

    /// Stop the server
    pub async fn stop(&mut self) {
        info!("🛑 Stopping MCP server (PID: {:?})", self.process_pid);

        Self::kill_orphaned_or_conflicting_processes().await;

        self.is_running.store(false, Ordering::Relaxed);
        self.is_ready.store(false, Ordering::Relaxed);
        self.port = 0;
        self.start_time = None;
        self.process_pid = None;
        self.consecutive_failures = 0;
    }

    /// Get server status information (fast, non-blocking)
    pub fn get_info(&self) -> McpServerInfo {
        let uptime_seconds = self
            .start_time
            .map(|start| start.elapsed().as_secs())
            .unwrap_or(0);

        // Try to get version from the binary
        let version = Self::get_binary_version();

        McpServerInfo {
            port: self.port,
            is_running: self.is_running.load(Ordering::Relaxed),
            is_ready: self.is_ready.load(Ordering::Relaxed),
            url: if self.port > 0 {
                format!("http://127.0.0.1:{}", self.port)
            } else {
                String::new()
            },
            uptime_seconds,
            version,
        }
    }

    /// Check and update readiness flag (async, can be slow)
    /// Call this periodically from frontend to update is_ready status
    pub async fn update_readiness(&mut self) -> bool {
        let is_running = self.is_running.load(Ordering::Relaxed);
        let is_ready = self.is_ready.load(Ordering::Relaxed);

        info!(
            "🔍 [MCP] update_readiness called: is_running={}, is_ready={}",
            is_running, is_ready
        );

        // Only check if server is running but not ready yet
        if is_running && !is_ready {
            info!("🔄 [MCP] Checking if /mcp endpoint is ready...");
            if self.is_mcp_endpoint_ready().await {
                info!("✅ [MCP] /mcp endpoint became ready, setting is_ready=true");
                self.is_ready.store(true, Ordering::Relaxed);
                return true;
            } else {
                info!("⚠️ [MCP] /mcp endpoint still not ready");
            }
        } else if is_ready {
            info!("✅ [MCP] Already ready, no check needed");
        }

        self.is_ready.load(Ordering::Relaxed)
    }

    /// Get the version of the MCP binary
    fn get_binary_version() -> Option<String> {
        use std::process::Command;

        // Helper to create command with hidden console window on Windows
        fn create_hidden_command(program: &str) -> Command {
            let mut cmd = Command::new(program);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            cmd
        }

        // Try to get the binary path - check common locations for current architecture
        let mut binary_paths = vec!["src-tauri/binaries/terminator-mcp-agent.exe"];
        #[cfg(target_arch = "x86_64")]
        binary_paths.push("src-tauri/binaries/terminator-mcp-agent-x86_64-pc-windows-msvc.exe");
        #[cfg(target_arch = "aarch64")]
        binary_paths.push("src-tauri/binaries/terminator-mcp-agent-aarch64-pc-windows-msvc.exe");

        for binary_path in binary_paths {
            if let Ok(output) = create_hidden_command(binary_path).arg("--version").output() {
                if let Ok(version_str) = String::from_utf8(output.stdout) {
                    // Parse "terminator-mcp-agent 0.17.9" -> "0.17.9"
                    if let Some(version) = version_str.split_whitespace().nth(1) {
                        return Some(version.trim().to_string());
                    }
                }
            }
        }

        None
    }

    /// Get the preferred port for this workspace variant
    /// Each workspace gets a dedicated port to prevent conflicts:
    /// - Production (ai.mediar.desktop): 8080
    /// - dev1 (ai.mediar.desktop.dev1): 8081
    /// - dev2 (ai.mediar.desktop.dev2): 8082
    /// - dev3 (ai.mediar.desktop.dev3): 8083
    /// - dev4 (ai.mediar.desktop.dev4): 8084
    /// - staging (ai.mediar.desktop.staging): 8085
    fn get_preferred_port() -> u16 {
        // Read the app identifier from Tauri's compile-time config
        // The identifier is set in tauri.conf.json and is different per workspace
        // Examples: "ai.mediar.desktop", "ai.mediar.desktop.dev1", "ai.mediar.desktop.dev2"
        let _identifier = env!("TAURI_ANDROID_PACKAGE_NAME_PREFIX"); // e.g., "ai_mediar_desktop"
        let app_name = env!("TAURI_ANDROID_PACKAGE_NAME_APP_NAME"); // e.g., "dev1" or empty for production

        // Map workspace variant to port
        match app_name {
            "dev1" => 8081,
            "dev2" => 8082,
            "dev3" => 8083,
            "dev4" => 8084,
            "staging" => 8085,
            _ => 8080, // Production or unknown variant
        }
    }

    /// Find available port, preferring the workspace-specific port
    async fn find_available_port() -> Result<u16, String> {
        let preferred_port = Self::get_preferred_port();

        // Try preferred port first
        match TcpListener::bind(format!("127.0.0.1:{preferred_port}")) {
            Ok(listener) => {
                drop(listener);
                info!(
                    "✅ Using preferred port {} for this workspace",
                    preferred_port
                );
                return Ok(preferred_port);
            }
            Err(_) => {
                warn!(
                    "⚠️ Preferred port {} is taken, scanning for alternative...",
                    preferred_port
                );
            }
        }

        // If preferred port is taken, scan for any available port
        // This allows graceful degradation if multiple instances of same workspace run
        for port in 8080..8200 {
            if port == preferred_port {
                continue; // Already tried this one
            }

            match TcpListener::bind(format!("127.0.0.1:{port}")) {
                Ok(listener) => {
                    drop(listener);
                    warn!(
                        "⚠️ Using fallback port {} (preferred {} was taken)",
                        port, preferred_port
                    );
                    return Ok(port);
                }
                Err(_) => continue,
            }
        }
        Err("No available ports found in range 8080-8200".to_string())
    }

    /// Kill orphaned or conflicting MCP processes (smart PID-based cleanup)
    /// Only kills:
    /// 1. Orphaned agents (parent process is dead)
    /// 2. Agents from previous runs of this app (same parent PID as current process)
    /// 3. Does NOT kill agents belonging to other running apps or editors
    async fn kill_orphaned_or_conflicting_processes() {
        use sysinfo::{ProcessesToUpdate, System};

        let current_pid = std::process::id();
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);

        info!(
            "🔍 Checking for orphaned or conflicting MCP agents (my PID: {})",
            current_pid
        );

        let mut killed_count = 0;

        for (pid, process) in system.processes() {
            let process_name = process.name().to_string_lossy().to_lowercase();

            // Only check terminator-mcp-agent processes
            if !process_name.contains("terminator-mcp-agent") {
                continue;
            }

            // Don't kill ourselves (shouldn't happen, but be safe)
            if pid.as_u32() == current_pid {
                continue;
            }

            // Get parent PID
            let parent_pid = match process.parent() {
                Some(p) => p,
                None => {
                    // No parent (very rare - only system processes)
                    // Kill it to be safe
                    warn!(
                        "🔴 Killing MCP agent PID {} (no parent - orphaned system process)",
                        pid
                    );
                    if process.kill() {
                        killed_count += 1;
                    }
                    continue;
                }
            };

            // Check if parent process is still alive
            let parent_alive = system.processes().contains_key(&parent_pid);

            if !parent_alive {
                // Parent is dead - this is an orphaned agent
                info!(
                    "🔴 Killing orphaned MCP agent PID {} (parent {} is dead)",
                    pid,
                    parent_pid.as_u32()
                );
                if process.kill() {
                    killed_count += 1;
                }
                continue;
            }

            // Check if this agent belongs to THIS app instance
            // (Should not happen unless we're restarting, but handle it)
            if parent_pid.as_u32() == current_pid {
                info!(
                    "🔴 Killing my previous MCP agent PID {} (same parent PID)",
                    pid
                );
                if process.kill() {
                    killed_count += 1;
                }
                continue;
            }

            // Parent is alive and it's NOT this app - LEAVE IT ALONE!
            // It belongs to another mediar-app instance or Claude Code/Cursor
            info!(
                "✅ Skipping MCP agent PID {} (belongs to parent PID {}, still alive)",
                pid,
                parent_pid.as_u32()
            );
        }

        if killed_count > 0 {
            info!(
                "🧹 Cleaned up {} orphaned/conflicting MCP agent(s)",
                killed_count
            );
            // Wait a bit for ports to be released
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        } else {
            info!("✨ No orphaned or conflicting MCP agents found");
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct McpServerInfo {
    pub port: u16,
    pub is_running: bool,
    pub is_ready: bool, // True only when /mcp endpoint is fully initialized
    pub url: String,
    pub uptime_seconds: u64,
    pub version: Option<String>,
}

/// Event payload for MCP health status changes
#[derive(Debug, Clone, serde::Serialize)]
pub struct McpHealthEvent {
    pub status: String, // "checking", "restarting", "ready", "failed"
    pub message: String,
    pub port: u16,
    pub restart_count: u32,
}

/// Initialize the MCP server (called at app startup)
pub async fn initialize_mcp_server(app_handle: tauri::AppHandle) {
    info!("🎯 Initializing MCP server management with bundled binary (no console window)");
    info!("📁 Looking for MCP binary in Tauri sidecar system...");

    // Start the server
    let server = MCP_SERVER.clone();
    let app_handle_clone = app_handle.clone();
    let app_handle_for_event = app_handle.clone();
    tokio::spawn(async move {
        info!("🔧 Acquiring MCP server manager lock...");
        let mut manager = server.lock().await;
        info!("🚀 Starting MCP server via manager...");
        match manager.ensure_running(app_handle_clone).await {
            Ok(port) => {
                info!("✅ MCP server started successfully on port {}", port);
                info!(
                    "📡 MCP server is now available at http://127.0.0.1:{}",
                    port
                );

                // Wait for /mcp endpoint to be ready
                manager.update_readiness().await;

                // Emit ready event so frontend knows to discover tools
                let _ = app_handle_for_event.emit(
                    "mcp:ready",
                    McpHealthEvent {
                        status: "ready".to_string(),
                        message: "MCP server is ready".to_string(),
                        port,
                        restart_count: manager.restart_count,
                    },
                );
            }
            Err(e) => {
                error!("❌ Failed to start MCP server: {}", e);
                error!("❌ MCP features will be unavailable");
                error!("❌ Please check that terminator-mcp-agent binary exists in the application directory");

                // Emit failed event
                let _ = app_handle_for_event.emit(
                    "mcp:failed",
                    McpHealthEvent {
                        status: "failed".to_string(),
                        message: format!("Failed to start: {}", e),
                        port: 0,
                        restart_count: manager.restart_count,
                    },
                );
            }
        }
    });

    // Start health monitoring and auto-restart (as safety net)
    // IMPORTANT: This loop is designed to minimize lock hold time to prevent deadlocks
    let server = MCP_SERVER.clone();
    let health_app_handle = app_handle.clone();
    tokio::spawn(async move {
        let mut check_interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            check_interval.tick().await;

            // Step 1: Get current state with brief lock
            let (auto_restart_enabled, port, restart_count, process_pid, is_running, is_ready, is_restarting, is_tool_executing) = {
                let manager = server.lock().await;
                (
                    manager.auto_restart_enabled,
                    manager.port,
                    manager.restart_count,
                    manager.process_pid,
                    manager.is_running.load(Ordering::Relaxed),
                    manager.is_ready.clone(),
                    manager.is_restarting.clone(),
                    manager.is_tool_executing.clone(),
                )
            };
            // Lock released here

            if !auto_restart_enabled {
                continue;
            }

            // Skip if restart already in progress
            if is_restarting.load(Ordering::Relaxed) {
                debug!("⏭️ Skipping health check - restart already in progress");
                continue;
            }

            // Skip if tool is currently executing (prevents false positive health check failures)
            if is_tool_executing.load(Ordering::Relaxed) {
                debug!("⏭️ Skipping health check - tool execution in progress");
                continue;
            }

            // Check if server is running and healthy
            if is_running {
                // Step 2: Do health check WITHOUT holding lock
                let is_healthy = do_health_check_standalone(port, process_pid).await;

                if !is_healthy {
                    // Try to set is_restarting flag - if already set, skip
                    if is_restarting
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
                        .is_err()
                    {
                        debug!("⏭️ Another restart in progress, skipping periodic restart");
                        continue;
                    }

                    warn!("⚠️ MCP server unhealthy (periodic check), restarting...");

                    // Emit restarting event (no lock needed)
                    let _ = health_app_handle.emit(
                        "mcp:restarting",
                        McpHealthEvent {
                            status: "restarting".to_string(),
                            message: format!(
                                "Periodic health check failed - restarting (attempt {})",
                                restart_count + 1
                            ),
                            port,
                            restart_count: restart_count + 1,
                        },
                    );

                    // Step 3: Acquire lock for state mutation
                    let mut manager = server.lock().await;
                    manager.stop().await;
                    match manager.ensure_running(health_app_handle.clone()).await {
                        Ok(new_port) => {
                            info!("✅ MCP server restarted successfully on port {}", new_port);

                            // Wait for /mcp endpoint to be ready
                            manager.update_readiness().await;
                            let final_restart_count = manager.restart_count;
                            drop(manager); // Release lock before emitting

                            // Clear restarting flag
                            is_restarting.store(false, Ordering::Relaxed);

                            // Emit ready event
                            let _ = health_app_handle.emit(
                                "mcp:ready",
                                McpHealthEvent {
                                    status: "ready".to_string(),
                                    message: "MCP server is ready".to_string(),
                                    port: new_port,
                                    restart_count: final_restart_count,
                                },
                            );
                        }
                        Err(e) => {
                            error!("❌ Failed to restart MCP server: {}", e);
                            let final_restart_count = manager.restart_count;
                            drop(manager); // Release lock before emitting

                            // Clear restarting flag even on failure
                            is_restarting.store(false, Ordering::Relaxed);

                            // Emit failed event
                            let _ = health_app_handle.emit(
                                "mcp:failed",
                                McpHealthEvent {
                                    status: "failed".to_string(),
                                    message: format!("Failed to restart: {}", e),
                                    port: 0,
                                    restart_count: final_restart_count,
                                },
                            );
                        }
                    }
                } else {
                    debug!("✅ MCP server health check passed");

                    // Continuously re-verify is_ready status to detect if server becomes busy
                    // This prevents infinite loops where is_ready=true but server returns 503
                    let current_ready = is_ready.load(Ordering::Relaxed);
                    if current_ready {
                        // Re-check if /mcp endpoint is still ready (without lock)
                        let still_ready = do_mcp_endpoint_check_standalone(port).await;
                        if !still_ready {
                            warn!("⚠️ MCP server marked as ready but /mcp endpoint now returns 503 - setting is_ready=false");
                            is_ready.store(false, Ordering::Relaxed);
                        }
                    }
                }
            } else {
                // Server not running, try to start it
                info!("🔄 MCP server not running, attempting to start...");

                // Acquire lock for starting
                let mut manager = server.lock().await;
                match manager.ensure_running(health_app_handle.clone()).await {
                    Ok(new_port) => {
                        info!(
                            "✅ MCP server auto-started successfully on port {}",
                            new_port
                        );

                        // Wait for /mcp endpoint to be ready
                        manager.update_readiness().await;
                        let final_restart_count = manager.restart_count;
                        drop(manager); // Release lock before emitting

                        // Emit ready event
                        let _ = health_app_handle.emit(
                            "mcp:ready",
                            McpHealthEvent {
                                status: "ready".to_string(),
                                message: "MCP server is ready".to_string(),
                                port: new_port,
                                restart_count: final_restart_count,
                            },
                        );
                    }
                    Err(e) => {
                        error!("❌ Failed to auto-start MCP server: {}", e);
                        let final_restart_count = manager.restart_count;
                        drop(manager); // Release lock before emitting

                        // Emit failed event
                        let _ = health_app_handle.emit(
                            "mcp:failed",
                            McpHealthEvent {
                                status: "failed".to_string(),
                                message: format!("Failed to start: {}", e),
                                port: 0,
                                restart_count: final_restart_count,
                            },
                        );
                    }
                }
            }
        }
    });
}

/// Get current MCP server info (fast, non-blocking)
pub async fn get_mcp_server_info() -> McpServerInfo {
    let server = MCP_SERVER.lock().await;
    server.get_info()
}

/// Check and update MCP server readiness (async, can be slow)
pub async fn update_mcp_readiness() -> bool {
    let mut server = MCP_SERVER.lock().await;
    server.update_readiness().await
}

/// Force restart the MCP server (useful for debugging)
pub async fn restart_mcp_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
    info!("🔄 Force restarting MCP server...");
    let mut server = MCP_SERVER.lock().await;
    server.stop().await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    server.ensure_running(app_handle).await
}

// Tauri commands for MCP server control

#[tauri::command]
#[specta::specta]
pub async fn start_mcp_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
    info!("🚀 Starting MCP server via command...");
    let mut server = MCP_SERVER.lock().await;
    server.ensure_running(app_handle).await
}

#[tauri::command]
#[specta::specta]
pub async fn stop_mcp_server() -> Result<(), String> {
    info!("🛑 Stopping MCP server via command...");
    let mut server = MCP_SERVER.lock().await;
    server.stop().await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn restart_mcp_server_command(app_handle: tauri::AppHandle) -> Result<u16, String> {
    restart_mcp_server(app_handle).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_mcp_server_info_command() -> Result<McpServerInfo, String> {
    Ok(get_mcp_server_info().await)
}

#[tauri::command]
#[specta::specta]
pub async fn update_mcp_readiness_command() -> Result<bool, String> {
    Ok(update_mcp_readiness().await)
}

/// Frontend reports connection failure - trigger immediate health check and restart if needed
///
/// IMPORTANT: This function is designed to avoid deadlocks by:
/// 1. Using is_restarting flag to prevent concurrent restart attempts
/// 2. Spawning restart in background so command returns immediately
/// 3. Releasing mutex before long async operations
#[tauri::command]
#[specta::specta]
pub async fn report_connection_failure(app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("⚠️ Frontend reported connection failure - initiating health check");

    // Step 1: Get current state (brief lock) and check if restart already in progress
    let (port, restart_count, process_pid, is_restarting) = {
        let server = MCP_SERVER.lock().await;
        (
            server.port,
            server.restart_count,
            server.process_pid,
            server.is_restarting.clone(),
        )
    };
    // Lock released here

    // If already restarting, don't block - just return immediately
    if is_restarting.load(Ordering::Relaxed) {
        info!("ℹ️ MCP server restart already in progress, skipping duplicate request");
        return Ok(());
    }

    // Emit health check starting event (no lock needed)
    let _ = app_handle.emit(
        "mcp:health-check-starting",
        McpHealthEvent {
            status: "checking".to_string(),
            message: "Verifying connection health...".to_string(),
            port,
            restart_count,
        },
    );

    // Step 2: Do health checks WITHOUT holding the lock
    // This prevents blocking other operations during the potentially slow HTTP requests
    let first_check = do_health_check_standalone(port, process_pid).await;

    if !first_check {
        info!("⚠️ First health check failed, retrying in 1 second...");
        sleep(Duration::from_secs(1)).await;

        let second_check = do_health_check_standalone(port, process_pid).await;

        if !second_check {
            // Confirmed failure - trigger restart
            // Set is_restarting flag BEFORE acquiring lock to prevent other callers from waiting
            if is_restarting
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
                .is_err()
            {
                info!("ℹ️ Another restart started while we were checking, skipping");
                return Ok(());
            }

            warn!("❌ Connection failure confirmed after 2 health checks - restarting MCP server");

            // Emit restarting event (no lock needed)
            let _ = app_handle.emit(
                "mcp:restarting",
                McpHealthEvent {
                    status: "restarting".to_string(),
                    message: format!("Restarting MCP server (attempt {})", restart_count + 1),
                    port,
                    restart_count: restart_count + 1,
                },
            );

            // Step 3: Spawn the restart in background so we don't block the Tauri command
            // This allows the UI to remain responsive while restart happens
            let app_handle_clone = app_handle.clone();
            let is_restarting_clone = is_restarting.clone();
            tokio::spawn(async move {
                let result = do_restart_in_background(app_handle_clone.clone()).await;

                // Clear the restarting flag
                is_restarting_clone.store(false, Ordering::Relaxed);

                if let Err(e) = result {
                    error!("❌ Background restart failed: {}", e);
                }
            });

            Ok(())
        } else {
            info!("✅ Second health check passed - connection recovered");
            Ok(())
        }
    } else {
        info!("✅ First health check passed - false alarm");
        Ok(())
    }
}

/// Perform MCP server restart in background (doesn't block the calling command)
///
/// CRITICAL: This function is designed to minimize lock hold time to prevent UI freezes.
/// We only hold the lock briefly for state mutations, not during long async operations.
async fn do_restart_in_background(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Step 1: Stop the server (brief lock)
    {
        let mut server = MCP_SERVER.lock().await;
        server.stop().await;
    }
    // Lock released - stop() is fast since it just kills a process

    // Step 2: Do the slow operations WITHOUT holding the lock
    // Kill orphaned processes (no lock needed - static function)
    McpServerManager::kill_orphaned_or_conflicting_processes().await;

    // Find available port (no lock needed - static function)
    let port = McpServerManager::find_available_port().await?;

    // Step 3: Brief lock to update state and spawn process
    let (process_result, restart_count) = {
        let mut server = MCP_SERVER.lock().await;
        server.port = port;
        server.restart_count += 1;

        // Check crash loop before spawning
        if server.restart_count > 5 {
            let error_msg = format!(
                "MCP server crash loop detected: {} restart attempts. Last error: {:?}",
                server.restart_count, server.last_error
            );
            return Err(error_msg);
        }

        let count = server.restart_count;
        // Actually spawn via ensure_running, but we've done prep work already
        // For now, call ensure_running which will skip the already-done cleanup steps
        let result = server.ensure_running(app_handle.clone()).await;
        (result, count)
    };
    // Lock released after spawning

    match process_result {
        Ok(new_port) => {
            info!("✅ MCP server restarted successfully on port {}", new_port);

            // Step 4: Wait for /mcp endpoint (brief lock for update_readiness)
            {
                let mut server = MCP_SERVER.lock().await;
                server.update_readiness().await;
            }

            // Emit ready event (no lock needed)
            let _ = app_handle.emit(
                "mcp:ready",
                McpHealthEvent {
                    status: "ready".to_string(),
                    message: "MCP server is ready".to_string(),
                    port: new_port,
                    restart_count,
                },
            );

            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to restart MCP server: {}", e);

            // Emit failed event (no lock needed)
            let _ = app_handle.emit(
                "mcp:failed",
                McpHealthEvent {
                    status: "failed".to_string(),
                    message: format!("Failed to restart: {}", e),
                    port: 0,
                    restart_count,
                },
            );

            Err(e)
        }
    }
}

/// Standalone MCP endpoint check that doesn't require holding the MCP_SERVER lock
/// Used to prevent deadlocks during periodic health monitoring
async fn do_mcp_endpoint_check_standalone(port: u16) -> bool {
    if port == 0 {
        return false;
    }

    let url = format!("http://127.0.0.1:{}/mcp", port);
    debug!("🔍 Checking /mcp endpoint readiness at: {}", url);

    // Try a simple POST request to /mcp (JSON-RPC initialize)
    // Use localhost_http_client() to bypass system proxy (VPN software like Clash/V2Ray)
    let client = localhost_http_client();
    let init_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "mediar-readiness-check", "version": "1.0.0" }
        }
    });

    match tokio::time::timeout(
        Duration::from_secs(5), // Short timeout for periodic checks
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(&init_body)
            .send(),
    )
    .await
    {
        Ok(Ok(response)) => {
            let status = response.status();
            // Accept any response that's NOT 503 Service Unavailable
            status.as_u16() != 503
        }
        Ok(Err(_)) | Err(_) => false,
    }
}

/// Standalone health check that doesn't require holding the MCP_SERVER lock
/// Used to prevent deadlocks during connection failure recovery
async fn do_health_check_standalone(port: u16, process_pid: Option<u32>) -> bool {
    if port == 0 {
        info!("🔍 Health check failed: no port assigned");
        return false;
    }

    // Validate PID if available
    if let Some(pid) = process_pid {
        if !McpServerManager::is_process_alive(pid) {
            error!("❌ Health check failed: Process PID {} is not alive", pid);
            return false;
        }
    }

    // Use a shorter timeout for connection failure checks (5 seconds instead of 30)
    // We want to fail fast and restart rather than waiting forever
    let timeout_secs = 5u64;

    let url = format!("http://127.0.0.1:{}/health", port);
    debug!(
        "🔍 Health checking MCP server at: {} (timeout: {}s, PID: {:?})",
        url, timeout_secs, process_pid
    );

    // Use localhost_http_client() to bypass system proxy (VPN software like Clash/V2Ray)
    match tokio::time::timeout(Duration::from_secs(timeout_secs), localhost_http_client().get(&url).send()).await {
        Ok(Ok(response)) => {
            let status = response.status();
            let is_success = status.is_success();
            if is_success {
                debug!(
                    "✅ Health check passed: {} {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("")
                );
            } else {
                warn!(
                    "⚠️ Health check failed: {} {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("")
                );
            }
            is_success
        }
        Ok(Err(e)) => {
            warn!("⚠️ Health check request failed: {}", e);
            false
        }
        Err(_) => {
            warn!("⚠️ Health check timed out after {} seconds", timeout_secs);
            false
        }
    }
}

/// Frontend reports MCP server is busy (503) - set is_ready=false to break retry loop
/// This is different from report_connection_failure - it doesn't trigger restart,
/// just updates the readiness flag so frontend stops retrying
#[tauri::command]
#[specta::specta]
pub async fn report_mcp_busy() -> Result<(), String> {
    info!("⚠️ Frontend reported MCP server busy (503) - setting is_ready=false");

    let server = MCP_SERVER.lock().await;
    let was_ready = server.is_ready.load(Ordering::Relaxed);

    if was_ready {
        server.is_ready.store(false, Ordering::Relaxed);
        info!("🔄 Set is_ready=false - frontend will wait for backend to detect readiness again");
    } else {
        info!("ℹ️ is_ready was already false");
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_mcp_tool_executing(executing: bool) -> Result<(), String> {
    let server = MCP_SERVER.lock().await;
    let was_executing = server.is_tool_executing.load(Ordering::Relaxed);

    if executing != was_executing {
        server.is_tool_executing.store(executing, Ordering::Relaxed);
        if executing {
            debug!("🔧 Tool execution started - health checks paused");
        } else {
            debug!("🔧 Tool execution ended - health checks resumed");
        }
    }

    Ok(())
}

/// Cleanup on app shutdown
pub async fn cleanup_mcp_server() {
    info!("🧹 Cleaning up MCP server");
    let mut server = MCP_SERVER.lock().await;
    server.auto_restart_enabled = false;
    server.stop().await;
}
