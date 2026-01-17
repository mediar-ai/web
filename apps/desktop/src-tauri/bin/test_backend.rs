/// Test Backend Binary
///
/// A comprehensive test binary that initializes all mediar backend services.
/// This allows running any backend functionality tests without the Tauri GUI.
///
/// Usage:
///   test_backend [OPTIONS]
///
/// Options:
///   --duration <SECONDS>        Run for specified duration (default: 30)
///   --no-events                 Disable event ingestion
///   --no-recorder              Disable workflow recorder
///   --no-highlighting          Disable visual highlighting during recording
///   --compact-yaml             Use compact YAML format for UI trees
///   --generate-mcp             Generate MCP workflow at end (default: false)
///   --run-test-workflow        Run Google Search test workflow automatically
///   --help                     Show this help message
use mediar_lib::{backend_init, event_ingestion, event_ingestion_mcp, ui_tree_capture};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;
use terminator_workflow_recorder::McpToolStep;
use tokio::process::Command;
use tokio::time::sleep;
use tracing::{error, info, warn};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging with DEBUG level to see Click event generation
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_target(false)
        .init();

    info!("🚀 Starting test_backend binary...");

    // Parse command-line arguments
    let args: Vec<String> = env::args().collect();
    let mut duration_secs = 30;
    let mut enable_events = true;
    let mut enable_recorder = true;
    let mut enable_highlighting = false; // Default: disabled
    let mut use_compact_yaml = true; // Default: enabled
    let mut generate_mcp = true; // Default: enabled
    let mut run_test_workflow = true; // Default: enabled

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--duration" => {
                if i + 1 < args.len() {
                    duration_secs = args[i + 1].parse().unwrap_or(30);
                    i += 2;
                } else {
                    eprintln!("Error: --duration requires a value");
                    print_help();
                    return Ok(());
                }
            }
            "--no-events" => {
                enable_events = false;
                i += 1;
            }
            "--no-recorder" => {
                enable_recorder = false;
                i += 1;
            }
            "--highlighting" => {
                enable_highlighting = true;
                i += 1;
            }
            "--compact-yaml" => {
                use_compact_yaml = true;
                i += 1;
            }
            "--generate-mcp" => {
                generate_mcp = true;
                i += 1;
            }
            "--run-test-workflow" => {
                run_test_workflow = true;
                // Auto-enable necessary features
                generate_mcp = true;
                use_compact_yaml = true; // Use compact YAML for better readability
                duration_secs = 20; // Override duration for automated test (NETR workflow is longer)
                i += 1;
            }
            "--manual" | "--no-auto-test" => {
                run_test_workflow = false;
                i += 1;
            }
            "--help" => {
                print_help();
                return Ok(());
            }
            _ => {
                eprintln!("Unknown argument: {}", args[i]);
                print_help();
                return Ok(());
            }
        }
    }

    info!("⚙️  Configuration:");
    info!("   Duration: {} seconds", duration_secs);
    info!(
        "   Event Ingestion: {}",
        if enable_events { "enabled" } else { "disabled" }
    );
    info!(
        "   Workflow Recorder: {}",
        if enable_recorder {
            "enabled"
        } else {
            "disabled"
        }
    );
    info!(
        "   Visual Highlighting: {}",
        if enable_highlighting {
            "enabled"
        } else {
            "disabled"
        }
    );
    info!(
        "   UI Tree Format: {}",
        if use_compact_yaml {
            "CompactYaml"
        } else {
            "Json"
        }
    );
    info!(
        "   Generate MCP: {}",
        if generate_mcp { "yes" } else { "no" }
    );
    info!(
        "   Run Test Workflow: {}",
        if run_test_workflow { "yes" } else { "no" }
    );

    // Initialize backend with configuration
    // Read clerk_user_id from .env file (matches the dev token)
    let test_user_id = env::var("TEST_BACKEND_USER_ID").unwrap_or_else(|_| {
        warn!("TEST_BACKEND_USER_ID not found in .env, using default");
        "user_2yybaElIb7XkotTLewoRaP40MKS".to_string()
    });

    let backend_config = backend_init::BackendConfig {
        user_id: Some(test_user_id),
        enable_event_ingestion: enable_events,
        enable_workflow_recorder: enable_recorder,
        enable_highlighting,
    };

    let backend_services = backend_init::init_backend(backend_config).await?;

    // Disable cloud sync for test_backend (events are only stored locally)
    if enable_events {
        if let Err(e) = event_ingestion::disable_cloud_sync().await {
            warn!("⚠️  Failed to disable cloud sync: {}", e);
        } else {
            info!("🔒 Cloud sync disabled - events will be recorded locally only");
        }
    }

    info!("✅ Backend services initialized successfully");

    // Set UI tree format if requested
    if use_compact_yaml {
        if let Err(e) = ui_tree_capture::set_format(ui_tree_capture::UITreeFormat::CompactYaml).await {
            error!("❌ Failed to set UI tree format: {}", e);
        } else {
            info!("✅ UI tree format set to CompactYaml");
        }
    }

    // Enable user recording (tells workflow recorder to send events)
    backend_services
        .user_recording_preference
        .store(true, Ordering::Relaxed);

    // If running test workflow, execute it automatically
    if run_test_workflow {
        info!("🧪 Running automated Google Search Anthropic test workflow...");
        info!("⏱️  Waiting 2 seconds for services to stabilize...");
        sleep(Duration::from_secs(2)).await;

        // Run the workflow via terminator CLI
        match run_google_search_workflow().await {
            Ok(workflow_output) => {
                info!("✅ Test workflow completed successfully");
                info!("📄 Workflow output:\n{}", workflow_output);
            }
            Err(e) => {
                error!("❌ Test workflow failed: {}", e);
                warn!("⚠️  Continuing with recording to capture partial results...");
            }
        }

        info!(
            "⏱️  Waiting {} more seconds to capture all events...",
            duration_secs - 2
        );
        sleep(Duration::from_secs((duration_secs - 2) as u64)).await;
    } else {
        info!("⏱️  Running for {} seconds...", duration_secs);
        info!("📋 Backend is active - events are being captured and processed");
        info!("💡 You can interact with your desktop to generate events");

        // Wait for specified duration
        for i in 1..=duration_secs {
            sleep(Duration::from_secs(1)).await;
            if i % 10 == 0 || i == duration_secs {
                info!("⏱️  Recording... {} seconds elapsed", i);
            }
        }
    }

    info!("⏱️  Time elapsed, stopping recording...");

    // Disable user recording
    backend_services
        .user_recording_preference
        .store(false, Ordering::Relaxed);

    info!("✅ Recording stopped");

    // Optionally generate MCP workflow
    if generate_mcp {
        info!("🔄 Converting recorded events to MCP workflow with UI diffs...");
        match event_ingestion_mcp::convert_session_to_mcp().await {
            Ok(mcp_steps) => {
                info!(
                    "✅ Conversion complete! {} MCP steps generated",
                    mcp_steps.len()
                );

                // Generate output
                let mut output = String::new();
                output.push_str("📋 MCP WORKFLOW WITH UI TREE DIFFS:\n");
                output.push_str("==========================================\n\n");

                if mcp_steps.is_empty() {
                    output.push_str("ℹ️  No MCP steps generated.\n");
                    output.push_str("   This happens when only keyboard events are recorded.\n");
                    output.push_str("   Try:\n");
                    output.push_str("   - Clicking buttons or UI elements\n");
                    output.push_str("   - Switching between applications\n");
                    output.push_str("   - Typing in text fields (wait for completion)\n");
                    output.push_str("   - Navigating in browser tabs\n\n");
                } else {
                    for (i, step) in mcp_steps.iter().enumerate() {
                        output.push_str(&format!("Step {}: {}\n", i + 1, step.tool_name));
                        output.push_str(&format!("  Description: {}\n", step.description));
                        output.push_str(&format!(
                            "  Arguments: {}\n",
                            serde_json::to_string_pretty(&step.arguments)?
                        ));
                        if let Some(timeout) = step.timeout_ms {
                            output.push_str(&format!("  Timeout: {timeout}ms\n"));
                        }
                        if let Some(delay) = step.delay_ms {
                            output.push_str(&format!("  Delay: {delay}ms\n"));
                        }

                        // Display expected UI changes (the key feature!)
                        if let Some(ref ui_changes) = step.expected_ui_changes {
                            output.push_str("  Expected UI Changes:\n");
                            for line in ui_changes.lines() {
                                output.push_str(&format!("    {line}\n"));
                            }
                        } else {
                            output.push_str("  Expected UI Changes: None (no UI state change detected)\n");
                        }

                        // Display expected DOM changes (for browser events)
                        if let Some(ref dom_changes) = step.expected_dom_changes {
                            output.push_str("  Expected DOM Changes:\n");
                            for line in dom_changes.lines() {
                                output.push_str(&format!("    {line}\n"));
                            }
                        } else if matches!(
                            step.tool_name.as_str(),
                            "execute_browser_script" | "navigate_browser"
                        ) {
                            output.push_str("  Expected DOM Changes: None (no DOM state change detected)\n");
                        }
                        output.push('\n');
                    }
                }

                output.push_str("==========================================\n");
                output.push_str(&format!(
                    "✅ Test complete! Generated {} MCP steps\n",
                    mcp_steps.len()
                ));

                // Count steps with diffs
                let steps_with_ui_diffs = mcp_steps
                    .iter()
                    .filter(|s| s.expected_ui_changes.is_some())
                    .count();
                let steps_with_dom_diffs = mcp_steps
                    .iter()
                    .filter(|s| s.expected_dom_changes.is_some())
                    .count();
                output.push_str(&format!("📊 Steps with UI diffs: {steps_with_ui_diffs}\n"));
                output.push_str(&format!(
                    "📊 Steps with DOM diffs: {steps_with_dom_diffs}\n"
                ));

                // If we ran the test workflow, validate the recorded steps
                if run_test_workflow {
                    output.push('\n');
                    output.push_str("🔍 VALIDATION RESULTS:\n");
                    output.push_str("==========================================\n");

                    let validation = validate_recorded_workflow(&mcp_steps);

                    output.push_str(&format!(
                        "✓ Navigate to Google: {}\n",
                        if validation.has_navigation {
                            "✅ PASS"
                        } else {
                            "❌ FAIL"
                        }
                    ));
                    output.push_str(&format!(
                        "✓ Click search box: {}\n",
                        if validation.has_click_search {
                            "✅ PASS"
                        } else {
                            "❌ FAIL"
                        }
                    ));
                    output.push_str(&format!(
                        "✓ Type 'Anthropic': {}\n",
                        if validation.has_type_text {
                            "✅ PASS"
                        } else {
                            "❌ FAIL"
                        }
                    ));
                    output.push_str(&format!(
                        "✓ Press Enter: {}\n",
                        if validation.has_press_enter {
                            "✅ PASS"
                        } else {
                            "❌ FAIL"
                        }
                    ));
                    output.push_str(&format!(
                        "✓ Click first result: {}\n",
                        if validation.has_click_result {
                            "✅ PASS"
                        } else {
                            "❌ FAIL"
                        }
                    ));

                    output.push('\n');
                    output.push_str(&format!(
                        "Overall Test Result: {}\n",
                        if validation.all_passed {
                            "✅ PASSED"
                        } else {
                            "❌ FAILED"
                        }
                    ));

                    if !validation.all_passed {
                        output.push_str("\n⚠️  Some expected events were not captured.\n");
                        output.push_str("   Possible reasons:\n");
                        output.push_str("   - Events occurred too quickly\n");
                        output.push_str("   - Browser was not focused\n");
                        output.push_str("   - Event filtering removed some events\n");
                    }

                    output.push_str("==========================================\n");
                }

                // Add raw events section
                output.push_str("\n\n📝 RAW EVENTS CAPTURED:\n");
                output.push_str("==========================================\n\n");

                // Get all events from the session
                if let Ok(events) = event_ingestion::get_recorded_events().await {
                    output.push_str(&format!("Total events captured: {}\n\n", events.len()));

                    for (i, event) in events.iter().enumerate() {
                        // Pretty-print the entire event as JSON
                        if let Ok(json) = serde_json::to_string_pretty(&event) {
                            output.push_str(&format!("Event {}:\n", i + 1));
                            for line in json.lines() {
                                output.push_str(&format!("  {line}\n"));
                            }
                            output.push('\n');
                        }
                    }
                } else {
                    output.push_str("ℹ️  No events available (session may have been cleared)\n");
                }

                output.push_str("==========================================\n");

                // Write to file
                let output_path =
                    PathBuf::from("C:\\Users\\screenpipe-windows\\AppData\\Local\\Temp\\test_backend_output.txt");
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&output_path, &output)?;

                info!("📄 Output written to: {}", output_path.display());

                // Also print to console
                println!("\n{output}");
            }
            Err(e) => {
                error!("❌ Failed to convert events to MCP: {}", e);
                return Err(Box::from(e));
            }
        }
    } else {
        info!("ℹ️  Skipping MCP generation (use --generate-mcp to enable)");
    }

    // Shutdown backend services
    info!("🛑 Shutting down backend services...");
    backend_init::shutdown_backend(backend_services).await?;
    info!("✅ Backend shut down successfully");

    info!("🎉 Test backend completed successfully!");

    Ok(())
}

fn print_help() {
    println!("Test Backend Binary - Full mediar backend for testing\n");
    println!("USAGE:");
    println!("    test_backend [OPTIONS]\n");
    println!("OPTIONS:");
    println!("    --duration <SECONDS>     Run for specified duration (default: 30)");
    println!("    --no-events             Disable event ingestion");
    println!("    --no-recorder           Disable workflow recorder");
    println!("    --highlighting          Enable visual highlighting during recording");
    println!("    --compact-yaml          Use compact YAML format for UI trees (default: true)");
    println!("    --generate-mcp          Generate MCP workflow at end (default: true)");
    println!("    --run-test-workflow     Run Google Search test workflow automatically (default: true)");
    println!("    --manual                Disable auto-test, record manual interactions only");
    println!("    --no-auto-test          Same as --manual");
    println!("    --help                  Show this help message\n");
    println!("EXAMPLES:");
    println!("    # Run for 60 seconds with all services enabled");
    println!("    test_backend --duration 60\n");
    println!("    # Test event ingestion only (no recorder, no MCP)");
    println!("    test_backend --no-recorder --duration 10\n");
    println!("    # Test compact YAML format and generate MCP workflow");
    println!("    test_backend --compact-yaml --generate-mcp --duration 20\n");
    println!("    # Run automated test with workflow validation (default behavior)");
    println!("    test_backend --run-test-workflow\n");
    println!("    # Manual recording mode - interact with your desktop for 30 seconds");
    println!("    test_backend --manual --duration 30\n");
    println!("    # Quick test with minimal services");
    println!("    test_backend --no-events --no-recorder --duration 5");
}

/// Run the Google Search Anthropic test workflow via terminator CLI
async fn run_google_search_workflow() -> Result<String, Box<dyn std::error::Error>> {
    let terminator_path = r"C:\Users\screenpipe-windows\terminator\target\release\terminator.exe";
    let mcp_agent_path = r"C:\Users\screenpipe-windows\terminator\target\release\terminator-mcp-agent.exe";
    let workflow_path = r"C:\Users\screenpipe-windows\AppData\Local\Temp\terminator-tests\google_search_anthropic.yml";

    info!("🚀 Executing terminator workflow...");
    info!("   Terminator: {}", terminator_path);
    info!("   MCP Agent: {}", mcp_agent_path);
    info!("   Workflow: {}", workflow_path);

    let output = Command::new(terminator_path)
        .args(["mcp", "run", "-c", mcp_agent_path, workflow_path])
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        error!("Workflow execution failed with status: {}", output.status);
        error!("STDERR: {}", stderr);
        return Err(format!("Workflow failed: {stderr}").into());
    }

    Ok(stdout.to_string())
}

/// Validation result for recorded workflow
struct WorkflowValidation {
    has_navigation: bool,
    has_click_search: bool,
    has_type_text: bool,
    has_press_enter: bool,
    has_click_result: bool,
    all_passed: bool,
}

/// Validate that the recorded MCP steps match the expected Google Search Anthropic workflow
fn validate_recorded_workflow(mcp_steps: &[McpToolStep]) -> WorkflowValidation {
    // Check for expected step types
    let has_navigation = mcp_steps.iter().any(|step| {
        step.tool_name == "navigate_browser"
            || (step.description.to_lowercase().contains("navigate")
                && step.description.to_lowercase().contains("google"))
    });

    let has_click_search = mcp_steps.iter().any(|step| {
        step.tool_name == "click_element"
            && (step.description.to_lowercase().contains("search")
                || step.description.to_lowercase().contains("combobox"))
    });

    let has_type_text = mcp_steps.iter().any(|step| {
        step.tool_name == "type_into_element"
            || (step.description.to_lowercase().contains("type")
                && step.description.to_lowercase().contains("anthropic"))
    });

    let has_press_enter = mcp_steps.iter().any(|step| {
        step.tool_name == "press_key"
            || (step.description.to_lowercase().contains("press") && step.description.to_lowercase().contains("enter"))
    });

    let has_click_result = mcp_steps.iter().any(|step| {
        step.tool_name == "click_element"
            && (step.description.to_lowercase().contains("anthropic")
                || step.description.to_lowercase().contains("result")
                || step.description.to_lowercase().contains("hyperlink"))
    });

    let all_passed = has_navigation && has_click_search && has_type_text && has_press_enter && has_click_result;

    WorkflowValidation {
        has_navigation,
        has_click_search,
        has_type_text,
        has_press_enter,
        has_click_result,
        all_passed,
    }
}
