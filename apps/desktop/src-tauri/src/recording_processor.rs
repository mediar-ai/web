//! Local Recording Processor
//!
//! Processes raw recording events locally using Gemini Vertex AI.
//! No database calls - everything in memory, outputs to .ts workflow files.
//!
//! This module provides an alternative to the web app + Modal processing pipeline.
//! Both paths can coexist - controlled by `local_processing` flag.

use crate::constants::GEMINI_MODEL;
use crate::event_ingestion::WorkflowEventRequest;
use crate::recording_prompts;
use crate::ui_tree_diff;
use crate::vertex_ai::{self, GenerationConfig, InlineImage, VertexAIRequest};
use chrono::Utc;
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// Data Structures
// =============================================================================

/// Result of step analysis from Gemini
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepAnalysis {
    pub step_title: String,
    pub step_summary: String,
    pub events_that_happened: String,
    pub how_content_changed: String,
    pub results_if_any: String,
    pub what_was_clicked: String,
    pub what_was_typed: String,
    pub user_intent: String,
    /// Added after labeling pass
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Original event timestamp (set after parsing, not from LLM)
    #[serde(default)]
    pub timestamp: String,
    /// Window title from the event (set after parsing, not from LLM)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
}

/// Substep within a workflow step
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Substep {
    pub substep_name: String,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub business_logic: Vec<String>,
}

/// High-level workflow step
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub step_name: String,
    pub substeps: Vec<Substep>,
}

/// Synthesized workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynthesizedWorkflow {
    pub title: String,
    pub description: String,
    pub steps: Vec<WorkflowStep>,
}

/// Full synthesis result from Gemini
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynthesisResult {
    pub workflows: Vec<SynthesizedWorkflow>,
}

/// Progress update for frontend - shows all stages upfront
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingProgress {
    pub stage: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
    /// Index of current stage (0-3)
    pub stage_index: usize,
    /// Total number of stages (always 4: step_analysis, labeling, synthesis, generation)
    pub total_stages: usize,
    /// Totals for all stages (step_analysis_total, labeling_total, synthesis_total, generation_total)
    pub stage_totals: Vec<usize>,
}

/// Recording processor state
pub struct RecordingProcessor {
    /// Raw events captured during recording
    pub events: Vec<WorkflowEventRequest>,
    /// Processed step analyses
    pub analyses: Vec<StepAnalysis>,
    /// Synthesized workflows
    pub workflows: Vec<SynthesizedWorkflow>,
    /// Session ID
    pub session_id: String,
    /// Whether processing is in progress
    pub is_processing: bool,
    // --- Streaming state ---
    /// Whether streaming analysis is active
    pub is_streaming: bool,
    /// Indices of meaningful events (click, text_input, navigation, etc.) in the events vec
    pub meaningful_event_indices: Vec<usize>,
    /// Completed analyses by meaningful event index
    pub streaming_analyses: HashMap<usize, StepAnalysis>,
    /// Indices of analyses that have been labeled
    pub streaming_labels: HashSet<usize>,
    /// Queue of meaningful indices waiting for analysis gate to pass
    pub analysis_queue: Vec<usize>,
}

impl RecordingProcessor {
    pub fn new(session_id: String) -> Self {
        info!(
            "[RECORDING_PROCESSOR] Created new processor for session: {}",
            session_id
        );
        Self {
            events: Vec::new(),
            analyses: Vec::new(),
            workflows: Vec::new(),
            session_id,
            is_processing: false,
            // Streaming state
            is_streaming: false,
            meaningful_event_indices: Vec::new(),
            streaming_analyses: HashMap::new(),
            streaming_labels: HashSet::new(),
            analysis_queue: Vec::new(),
        }
    }

    /// Add a raw event to the processor
    pub fn add_event(&mut self, event: WorkflowEventRequest) {
        debug!("[RECORDING_PROCESSOR] Adding event type: {}", event.r#type);
        self.events.push(event);
    }

    /// Get count of events
    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    /// Clear all data
    pub fn clear(&mut self) {
        info!("[RECORDING_PROCESSOR] Clearing processor data");
        self.events.clear();
        self.analyses.clear();
        self.workflows.clear();
        self.is_processing = false;
        // Clear streaming state
        self.is_streaming = false;
        self.meaningful_event_indices.clear();
        self.streaming_analyses.clear();
        self.streaming_labels.clear();
        self.analysis_queue.clear();
    }
}

// Global processor instance
static RECORDING_PROCESSOR: Lazy<Arc<RwLock<Option<RecordingProcessor>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

// =============================================================================
// Public API
// =============================================================================

/// Initialize a new recording processor for a session
pub async fn init_processor(session_id: String) {
    info!(
        "[RECORDING_PROCESSOR] Initializing processor for session: {}",
        session_id
    );
    let mut guard = RECORDING_PROCESSOR.write().await;
    *guard = Some(RecordingProcessor::new(session_id));
}

/// Update the session_id to sync with workflow folder ID
pub async fn set_session_id(session_id: String) {
    info!(
        "[RECORDING_PROCESSOR] Updating session_id to: {}",
        session_id
    );
    let mut guard = RECORDING_PROCESSOR.write().await;
    if let Some(processor) = guard.as_mut() {
        processor.session_id = session_id;
    } else {
        // If no processor exists, initialize one with this session_id
        *guard = Some(RecordingProcessor::new(session_id));
    }
}

/// Add an event to the current processor
pub async fn add_event(event: WorkflowEventRequest) {
    let should_process_queue = {
        let mut guard = RECORDING_PROCESSOR.write().await;
        if let Some(processor) = guard.as_mut() {
            let event_type = event.r#type.clone();
            let event_idx = processor.events.len();
            processor.add_event(event);

            // If streaming and this is a meaningful event, track it and queue for analysis
            if processor.is_streaming && is_meaningful_event_type(&event_type) {
                let meaningful_idx = processor.meaningful_event_indices.len();
                processor.meaningful_event_indices.push(event_idx);
                processor.analysis_queue.push(meaningful_idx);
                info!(
                    "[STREAMING] Queued meaningful event {} (type: {}) for analysis",
                    meaningful_idx, event_type
                );
                true
            } else {
                false
            }
        } else {
            warn!("[RECORDING_PROCESSOR] No active processor, event dropped");
            false
        }
    };

    // Process queue outside the lock
    if should_process_queue {
        process_analysis_queue().await;
    }
}

/// Get event count
pub async fn get_event_count() -> usize {
    let guard = RECORDING_PROCESSOR.read().await;
    guard.as_ref().map(|p| p.event_count()).unwrap_or(0)
}

// =============================================================================
// Streaming Analysis API
// =============================================================================

/// Check if an event type is meaningful for step-by-step analysis
/// Note: Event type strings must match those produced by event_ingestion.rs:
/// - "button_click" (native desktop clicks) and "browser_click" (browser DOM clicks)
/// - "file_opened" (not "file_change")
fn is_meaningful_event_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "button_click"
            | "browser_click"
            | "text_input_completed"
            | "browser_tab_navigation"
            | "application_switch"
            | "file_opened"
    )
}

/// Start streaming analysis mode - analyses will run as events arrive
pub async fn start_streaming() {
    info!("[STREAMING] Starting streaming analysis mode");
    let mut guard = RECORDING_PROCESSOR.write().await;
    if let Some(processor) = guard.as_mut() {
        processor.is_streaming = true;
        processor.streaming_analyses.clear();
        processor.streaming_labels.clear();
        processor.analysis_queue.clear();
    }
}

/// Stop streaming analysis mode
pub async fn stop_streaming() {
    info!("[STREAMING] Stopping streaming analysis mode");
    let mut guard = RECORDING_PROCESSOR.write().await;
    if let Some(processor) = guard.as_mut() {
        processor.is_streaming = false;
    }
}

/// Check if streaming is active
pub async fn is_streaming() -> bool {
    let guard = RECORDING_PROCESSOR.read().await;
    guard.as_ref().map(|p| p.is_streaming).unwrap_or(false)
}

/// Get streaming stats for frontend
pub async fn get_streaming_stats() -> (usize, usize, usize) {
    let guard = RECORDING_PROCESSOR.read().await;
    if let Some(processor) = guard.as_ref() {
        (
            processor.meaningful_event_indices.len(),
            processor.streaming_analyses.len(),
            processor.streaming_labels.len(),
        )
    } else {
        (0, 0, 0)
    }
}

/// Check if analysis gate passes for a meaningful event index
/// Previously required analyses [N-3, N-1] to be complete, but this caused sequential execution.
/// Now always returns true to enable true parallel processing.
/// The analyze_step function gracefully handles missing previous analyses via filter_map.
fn check_analysis_gate(_meaningful_idx: usize, _completed: &HashMap<usize, StepAnalysis>) -> bool {
    // Always allow parallel analysis - the analyze_step function uses filter_map
    // to gracefully handle missing previous analyses (it just uses whatever is available)
    true
}

/// Check if labeling gate passes for a meaningful event index
/// Labeling N requires analyses [N-5, N+5] to be complete
fn check_labeling_gate(
    meaningful_idx: usize,
    total_meaningful: usize,
    completed: &HashMap<usize, StepAnalysis>,
    labeled: &HashSet<usize>,
) -> bool {
    // Skip if already labeled
    if labeled.contains(&meaningful_idx) {
        return false;
    }
    // Must have our own analysis
    if !completed.contains_key(&meaningful_idx) {
        return false;
    }
    let start = meaningful_idx.saturating_sub(5);
    let end = std::cmp::min(meaningful_idx + 6, total_meaningful);
    for i in start..end {
        if !completed.contains_key(&i) {
            return false;
        }
    }
    true
}

/// Process analysis queue - spawn analyses for events whose gates pass
/// This is called after an analysis completes to check if queued events can now proceed
pub async fn process_analysis_queue() {
    process_analysis_queue_inner().await;
}

/// Inner implementation of analysis queue processing
async fn process_analysis_queue_inner() {
    // Collect data needed for spawning analyses
    let analyses_to_spawn: Vec<(
        usize,
        WorkflowEventRequest,
        Vec<StepAnalysis>,
        Vec<WorkflowEventRequest>,
        Vec<WorkflowEventRequest>,
    )> = {
        let mut guard = RECORDING_PROCESSOR.write().await;
        let processor = match guard.as_mut() {
            Some(p) if p.is_streaming => p,
            _ => return,
        };

        let mut to_spawn = Vec::new();
        let mut indices_to_remove = Vec::new();

        for &meaningful_idx in &processor.analysis_queue {
            if check_analysis_gate(meaningful_idx, &processor.streaming_analyses) {
                let event_idx = processor.meaningful_event_indices[meaningful_idx];
                let event = processor.events[event_idx].clone();

                // Get previous analyses for context (last 3)
                let previous: Vec<StepAnalysis> = (0..meaningful_idx)
                    .rev()
                    .take(3)
                    .filter_map(|i| processor.streaming_analyses.get(&i).cloned())
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();

                let all_events = processor.events.clone();
                let ui_trees: Vec<WorkflowEventRequest> = processor
                    .events
                    .iter()
                    .filter(|e| e.r#type == "ui_tree")
                    .cloned()
                    .collect();

                to_spawn.push((meaningful_idx, event, previous, all_events, ui_trees));
                indices_to_remove.push(meaningful_idx);
            }
        }

        // Remove from queue
        processor
            .analysis_queue
            .retain(|idx| !indices_to_remove.contains(idx));

        to_spawn
    };

    // Spawn analysis tasks outside the lock
    for (meaningful_idx, event, previous, all_events, ui_trees) in analyses_to_spawn {
        info!(
            "[STREAMING] Gate passed for index {}, spawning analysis",
            meaningful_idx
        );
        tokio::spawn(async move {
            let ui_tree_refs: Vec<&WorkflowEventRequest> = ui_trees.iter().collect();
            match analyze_step(&event, &previous, &all_events, &ui_tree_refs).await {
                Ok(analysis) => {
                    info!(
                        "[STREAMING] Analysis complete for index {}: '{}'",
                        meaningful_idx, analysis.step_title
                    );
                    // Store result and check for more work (spawns its own task)
                    store_analysis_result(meaningful_idx, analysis);
                }
                Err(e) => {
                    warn!(
                        "[STREAMING] Analysis failed for index {}: {}",
                        meaningful_idx, e
                    );
                }
            }
        });
    }
}

/// Store a completed analysis and trigger follow-up work
fn store_analysis_result(meaningful_idx: usize, analysis: StepAnalysis) {
    // Spawn a task to store and process follow-up work
    tokio::spawn(async move {
        // Store the result
        {
            let mut guard = RECORDING_PROCESSOR.write().await;
            if let Some(processor) = guard.as_mut() {
                processor
                    .streaming_analyses
                    .insert(meaningful_idx, analysis);
                info!(
                    "[STREAMING] Stored analysis {}, total: {}",
                    meaningful_idx,
                    processor.streaming_analyses.len()
                );
            }
        }

        // Process any queued analyses that might now be ready
        process_analysis_queue_inner().await;

        // Check and trigger labeling for any analyses that now have enough neighbors
        process_labeling_queue_inner().await;
    });
}

/// Check and trigger labeling for analyses that have all neighbors complete
pub async fn process_labeling_queue() {
    process_labeling_queue_inner().await;
}

/// Inner implementation of labeling queue processing
async fn process_labeling_queue_inner() {
    // Collect labeling work to do
    let labeling_to_spawn: Vec<(usize, StepAnalysis, Vec<StepAnalysis>)> = {
        let mut guard = RECORDING_PROCESSOR.write().await;
        let processor = match guard.as_mut() {
            Some(p) if p.is_streaming => p,
            _ => return,
        };

        let total = processor.meaningful_event_indices.len();
        let mut to_spawn = Vec::new();

        for (&idx, analysis) in &processor.streaming_analyses {
            if check_labeling_gate(
                idx,
                total,
                &processor.streaming_analyses,
                &processor.streaming_labels,
            ) {
                // Collect neighbor analyses for context
                let start = idx.saturating_sub(5);
                let end = std::cmp::min(idx + 6, total);
                let neighbors: Vec<StepAnalysis> = (start..end)
                    .filter(|&i| i != idx)
                    .filter_map(|i| processor.streaming_analyses.get(&i).cloned())
                    .collect();

                to_spawn.push((idx, analysis.clone(), neighbors));
                processor.streaming_labels.insert(idx); // Mark as in-progress
            }
        }

        to_spawn
    };

    // Spawn labeling tasks outside the lock
    for (idx, analysis, neighbors) in labeling_to_spawn {
        info!(
            "[STREAMING] Labeling gate passed for index {}, spawning labeling",
            idx
        );
        tokio::spawn(async move {
            // Build neighbor context string directly (matching add_label logic)
            let mut neighbor_context = String::new();
            for neighbor in &neighbors {
                neighbor_context.push_str(&format!(
                    "[{}] {}: {}\n",
                    neighbor.timestamp, neighbor.step_title, neighbor.step_summary
                ));
            }

            match label_step_inline(&analysis, &neighbor_context).await {
                Ok(label) => {
                    info!(
                        "[STREAMING] Labeling complete for index {}: '{}'",
                        idx, label
                    );
                    store_label_result(idx, label).await;
                }
                Err(e) => {
                    warn!("[STREAMING] Labeling failed for index {}: {}", idx, e);
                }
            }
        });
    }
}

/// Inline labeling function (avoids duplicate with add_label by extracting core logic)
async fn label_step_inline(target: &StepAnalysis, neighbor_context: &str) -> Result<String, String> {
    let prompt = format!(
        "{}\n\nTARGET STEP TO LABEL:\n{}: {}\n\nNEIGHBORING STEPS (for context):\n{}",
        recording_prompts::CONTEXT_AWARE_STEP_LABEL_PROMPT,
        target.step_title,
        target.step_summary,
        neighbor_context
    );

    let response_schema: serde_json::Value = serde_json::from_str(recording_prompts::LABEL_SUGGESTION_SCHEMA)
        .map_err(|e| format!("Failed to parse label schema: {}", e))?;

    let request = VertexAIRequest {
        model: GEMINI_MODEL.to_string(),
        input: Some(prompt),
        history: Vec::new(),
        system: None,
        tools: Vec::new(),
        tool_results: None,
        generation_config: Some(GenerationConfig {
            temperature: Some(0.2),
            max_output_tokens: Some(1024),
            response_mime_type: Some("application/json".to_string()),
            response_schema: Some(response_schema),
        }),
        thinking_level: None,
        mode: None,
        inline_images: None,
    };

    let response = vertex_ai::call_vertex_ai(request).await?;
    let json_str = extract_json(&response.text);

    #[derive(Deserialize)]
    struct LabelResponse {
        label: String,
    }

    let label_response: LabelResponse =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse label response: {}", e))?;

    Ok(label_response.label)
}

/// Store a completed label result
async fn store_label_result(meaningful_idx: usize, label: String) {
    let mut guard = RECORDING_PROCESSOR.write().await;
    if let Some(processor) = guard.as_mut() {
        if let Some(analysis) = processor.streaming_analyses.get_mut(&meaningful_idx) {
            analysis.label = Some(label);
        }
        info!(
            "[STREAMING] Stored label for {}, total labeled: {}",
            meaningful_idx,
            processor.streaming_labels.len()
        );
    }
}

/// Recorder session data for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderSessionData {
    pub workflow_folder: String,
    pub analysis_markdown: String,
    pub synthesis_result: SynthesisResult,
    pub step_analyses: Vec<StepAnalysis>,
    pub raw_events: Vec<Value>,
}

/// Get recorder session data after processing completes
/// Returns None if processing hasn't completed or no data available
pub async fn get_recorder_session_data(workflow_folder: &PathBuf) -> Option<RecorderSessionData> {
    let guard = RECORDING_PROCESSOR.read().await;
    let processor = guard.as_ref()?;

    // Don't return data if still processing
    if processor.is_processing {
        return None;
    }

    // Read the analysis markdown from README.md
    let readme_path = workflow_folder.join("README.md");
    let md_content = std::fs::read_to_string(&readme_path).unwrap_or_default();

    // Convert raw events to JSON values
    let raw_events: Vec<Value> = processor
        .events
        .iter()
        .filter_map(|e| serde_json::to_value(e).ok())
        .collect();

    Some(RecorderSessionData {
        workflow_folder: workflow_folder.to_string_lossy().to_string(),
        analysis_markdown: md_content,
        synthesis_result: SynthesisResult {
            workflows: processor.workflows.clone(),
        },
        step_analyses: processor.analyses.clone(),
        raw_events,
    })
}

/// Process all events and generate workflow output
/// Returns the path to the generated workflow folder
pub async fn process_recording(
    workflow_folder: PathBuf,
    progress_callback: impl Fn(ProcessingProgress) + Send + Sync,
) -> Result<PathBuf, String> {
    info!(
        "[RECORDING_PROCESSOR] Starting local processing to: {:?}",
        workflow_folder
    );

    // Stop streaming and get current state
    stop_streaming().await;

    // Get processor state and streaming data
    let (events, session_id, streaming_analyses, streaming_labels, meaningful_indices) = {
        let mut guard = RECORDING_PROCESSOR.write().await;
        let processor = guard.as_mut().ok_or("No active processor")?;
        if processor.is_processing {
            return Err("Processing already in progress".to_string());
        }
        processor.is_processing = true;

        (
            processor.events.clone(),
            processor.session_id.clone(),
            processor.streaming_analyses.clone(),
            processor.streaming_labels.clone(),
            processor.meaningful_event_indices.clone(),
        )
    };

    let total_events = events.len();
    info!(
        "[RECORDING_PROCESSOR] Processing {} events for session {}",
        total_events, session_id
    );
    info!(
        "[RECORDING_PROCESSOR] Streaming state: {} analyses, {} labels completed during recording",
        streaming_analyses.len(),
        streaming_labels.len()
    );

    if total_events == 0 {
        return Err("No events to process".to_string());
    }

    // Extract UI tree events for context (captured alongside action events)
    let ui_tree_events: Vec<_> = events.iter().filter(|e| e.r#type == "ui_tree").collect();
    info!(
        "[RECORDING_PROCESSOR] Found {} UI tree events for context",
        ui_tree_events.len()
    );

    // Get meaningful events - use streaming indices if available, otherwise filter
    let meaningful_events: Vec<&WorkflowEventRequest> = if !meaningful_indices.is_empty() {
        meaningful_indices
            .iter()
            .filter_map(|&idx| events.get(idx))
            .collect()
    } else {
        events
            .iter()
            .filter(|e| is_meaningful_event_type(&e.r#type))
            .collect()
    };

    let meaningful_count = meaningful_events.len();
    info!(
        "[RECORDING_PROCESSOR] Found {} meaningful events (click/text/nav/switch/file)",
        meaningful_count
    );

    // Stage totals: [step_analysis, labeling, synthesis, generation]
    let remaining_analyses = meaningful_count.saturating_sub(streaming_analyses.len());
    let mut stage_totals = vec![meaningful_count, meaningful_count, 1, 2];
    const TOTAL_STAGES: usize = 4;

    // Stage 1: Complete any remaining analyses (use streaming results where available)
    progress_callback(ProcessingProgress {
        stage: "step_analysis".to_string(),
        current: streaming_analyses.len(),
        total: meaningful_count,
        message: format!(
            "Using {} analyses from streaming, completing {} remaining...",
            streaming_analyses.len(),
            remaining_analyses
        ),
        stage_index: 0,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    let mut analyses: Vec<StepAnalysis> = Vec::with_capacity(meaningful_count);

    for (i, event) in meaningful_events.iter().enumerate() {
        // Check if we have a streaming result for this index
        if let Some(analysis) = streaming_analyses.get(&i) {
            info!(
                "[RECORDING_PROCESSOR] Using streaming analysis for step {}: '{}'",
                i + 1,
                analysis.step_title
            );
            analyses.push(analysis.clone());
        } else {
            // Need to analyze this event
            progress_callback(ProcessingProgress {
                stage: "step_analysis".to_string(),
                current: analyses.len() + 1,
                total: meaningful_count,
                message: format!("Analyzing step {} of {}", i + 1, meaningful_count),
                stage_index: 0,
                total_stages: TOTAL_STAGES,
                stage_totals: stage_totals.clone(),
            });

            match analyze_step(event, &analyses, &events, &ui_tree_events).await {
                Ok(analysis) => {
                    info!(
                        "[RECORDING_PROCESSOR] Step {} analyzed OK: '{}'",
                        i + 1,
                        analysis.step_title
                    );
                    analyses.push(analysis);
                }
                Err(e) => {
                    warn!(
                        "[RECORDING_PROCESSOR] Failed to analyze step {}: {}",
                        i + 1,
                        e
                    );
                    // Continue with other steps
                }
            }
        }
    }

    info!(
        "[RECORDING_PROCESSOR] Analyzed {} steps successfully ({} from streaming)",
        analyses.len(),
        streaming_analyses.len()
    );

    // Update stage_totals with actual labeling count
    stage_totals[1] = analyses.len();

    // Stage 2: Complete remaining labels (use streaming results where available)
    let remaining_labels = analyses.len().saturating_sub(streaming_labels.len());
    progress_callback(ProcessingProgress {
        stage: "labeling".to_string(),
        current: streaming_labels.len(),
        total: analyses.len(),
        message: format!(
            "Using {} labels from streaming, completing {} remaining...",
            streaming_labels.len(),
            remaining_labels
        ),
        stage_index: 1,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    for i in 0..analyses.len() {
        // Skip if already labeled during streaming
        if streaming_labels.contains(&i) {
            debug!(
                "[RECORDING_PROCESSOR] Step {} already labeled during streaming",
                i + 1
            );
            continue;
        }

        progress_callback(ProcessingProgress {
            stage: "labeling".to_string(),
            current: i + 1,
            total: analyses.len(),
            message: format!("Labeling step {} of {}", i + 1, analyses.len()),
            stage_index: 1,
            total_stages: TOTAL_STAGES,
            stage_totals: stage_totals.clone(),
        });

        match add_label(&mut analyses, i).await {
            Ok(_) => {
                debug!("[RECORDING_PROCESSOR] Step {} labeled", i + 1);
            }
            Err(e) => {
                warn!(
                    "[RECORDING_PROCESSOR] Failed to label step {}: {}",
                    i + 1,
                    e
                );
            }
        }
    }

    // Stage 3: Synthesize workflow
    progress_callback(ProcessingProgress {
        stage: "synthesis".to_string(),
        current: 0,
        total: 1,
        message: "Synthesizing workflow structure...".to_string(),
        stage_index: 2,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    let synthesis_result = synthesize_workflow(&analyses).await?;

    progress_callback(ProcessingProgress {
        stage: "synthesis".to_string(),
        current: 1,
        total: 1,
        message: format!(
            "Synthesized {} workflow(s)",
            synthesis_result.workflows.len()
        ),
        stage_index: 2,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    // Stage 4: Generate outputs (TypeScript + Markdown)
    progress_callback(ProcessingProgress {
        stage: "generation".to_string(),
        current: 0,
        total: 2,
        message: "Generating workflow files...".to_string(),
        stage_index: 3,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    // Generate TypeScript output
    generate_typescript_output(&workflow_folder, &synthesis_result, &analyses).await?;

    progress_callback(ProcessingProgress {
        stage: "generation".to_string(),
        current: 1,
        total: 2,
        message: "Generating markdown analysis...".to_string(),
        stage_index: 3,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    // Generate markdown output in recordings folder
    let md_path = generate_markdown_output(&workflow_folder, &session_id, &analyses, &synthesis_result)?;
    info!(
        "[RECORDING_PROCESSOR] Markdown analysis written to: {:?}",
        md_path
    );

    progress_callback(ProcessingProgress {
        stage: "generation".to_string(),
        current: 2,
        total: 2,
        message: "All output files generated successfully".to_string(),
        stage_index: 3,
        total_stages: TOTAL_STAGES,
        stage_totals: stage_totals.clone(),
    });

    // Store results and mark as done
    {
        let mut guard = RECORDING_PROCESSOR.write().await;
        if let Some(processor) = guard.as_mut() {
            processor.analyses = analyses;
            processor.workflows = synthesis_result.workflows;
            processor.is_processing = false;
        }
    }

    info!(
        "[RECORDING_PROCESSOR] Processing complete, output at: {:?}",
        workflow_folder
    );
    Ok(workflow_folder)
}

/// Clear the processor
pub async fn clear_processor() {
    let mut guard = RECORDING_PROCESSOR.write().await;
    if let Some(processor) = guard.as_mut() {
        processor.clear();
    }
}

// =============================================================================
// Internal Processing Functions
// =============================================================================

/// Find UI trees captured just before and after an event timestamp
/// Returns (tree_before, tree_after) based on timestamp proximity
fn find_surrounding_ui_trees<'a>(
    event_timestamp: &str,
    ui_tree_events: &'a [&WorkflowEventRequest],
) -> (
    Option<&'a WorkflowEventRequest>,
    Option<&'a WorkflowEventRequest>,
) {
    if ui_tree_events.is_empty() {
        return (None, None);
    }

    // Find tree just before (closest timestamp <= event_timestamp)
    let tree_before = ui_tree_events
        .iter()
        .filter(|t| t.timestamp.as_str() <= event_timestamp)
        .max_by_key(|t| &t.timestamp)
        .copied();

    // Find tree just after (closest timestamp > event_timestamp)
    let tree_after = ui_tree_events
        .iter()
        .filter(|t| t.timestamp.as_str() > event_timestamp)
        .min_by_key(|t| &t.timestamp)
        .copied();

    (tree_before, tree_after)
}

/// Find the screenshot_diff event closest to (and after) a given action event timestamp.
/// Returns the ScreenshotDiff with before/after images if found.
fn find_screenshot_for_event<'a>(
    event_timestamp: &str,
    all_events: &'a [WorkflowEventRequest],
) -> Option<&'a crate::event_ingestion::ScreenshotDiff> {
    all_events
        .iter()
        .filter(|e| e.r#type == "screenshot_diff")
        .filter_map(|e| e.event.screenshot_diff.as_ref())
        // Find screenshot where after_timestamp is >= event timestamp (captured after action)
        .filter(|sd| sd.after_timestamp.as_str() >= event_timestamp)
        // Get the closest one (smallest after_timestamp)
        .min_by_key(|sd| &sd.after_timestamp)
}

/// Strip data URL prefix from base64 image string.
/// Converts "data:image/png;base64,ABC123" to "ABC123"
fn strip_data_url_prefix(data_url: &str) -> &str {
    if let Some(pos) = data_url.find(",") {
        &data_url[pos + 1..]
    } else {
        data_url // Already raw base64
    }
}

/// Extract inline images from screenshot_diff for Vertex AI
fn extract_inline_images(screenshot_diff: &crate::event_ingestion::ScreenshotDiff) -> Vec<InlineImage> {
    let mut images = Vec::new();

    // Add "before" image if not empty
    if !screenshot_diff.before.is_empty() {
        images.push(InlineImage {
            data: strip_data_url_prefix(&screenshot_diff.before).to_string(),
            mime_type: "image/png".to_string(),
        });
    }

    // Add "after" image
    if !screenshot_diff.after.is_empty() {
        images.push(InlineImage {
            data: strip_data_url_prefix(&screenshot_diff.after).to_string(),
            mime_type: "image/png".to_string(),
        });
    }

    images
}

/// Extract UI tree string from a UI tree event
fn extract_ui_tree_string(event: &WorkflowEventRequest) -> Option<&str> {
    event.event.screen.as_ref().map(|s| s.ui_tree.as_str())
}

/// Roman numerals for UI tree indentation (matching web app)
const ROMAN_NUMERALS: &[&str] = &[
    "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII",
    "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX",
];

/// Generate simplified UI tree string from raw JSON - matches web app format exactly
/// Format: "LineNumber. RomanNumeralIndentation. [Role] 'Name' {Attributes}"
fn generate_simplified_ui_tree_string(ui_tree_json: &str) -> Option<String> {
    let tree: Value = serde_json::from_str(ui_tree_json).ok()?;

    fn build_node_string(node: &Value, level: usize, line_counter: &mut usize) -> Vec<String> {
        let mut output = Vec::new();

        let attributes = node.get("attributes").and_then(|a| a.as_object());
        let role = attributes
            .and_then(|a| a.get("role"))
            .and_then(|r| r.as_str())
            .unwrap_or("unknown");
        let name = attributes
            .and_then(|a| a.get("name"))
            .and_then(|n| n.as_str());

        // Build relevant attributes string (value, checked, selected, short urls)
        let mut attr_parts = Vec::new();
        if let Some(attrs) = attributes {
            if let Some(value) = attrs.get("value") {
                attr_parts.push(format!("value={}", value));
            }
            if let Some(checked) = attrs.get("checked") {
                attr_parts.push(format!("checked={}", checked));
            }
            if let Some(selected) = attrs.get("selected") {
                attr_parts.push(format!("selected={}", selected));
            }
            if let Some(url) = attrs.get("url").and_then(|u| u.as_str()) {
                if url.len() < 100 {
                    attr_parts.push(format!("url=\"{}\"", url));
                }
            }
        }

        // Build the line
        let roman = if level < ROMAN_NUMERALS.len() {
            ROMAN_NUMERALS[level]
        } else {
            "XXX+"
        };

        let mut line = format!("{}. {}. [{}]", line_counter, roman, role);
        if let Some(n) = name {
            if !n.is_empty() {
                line.push_str(&format!(" '{}'", n));
            }
        }
        if !attr_parts.is_empty() {
            line.push_str(&format!(" {{{}}}", attr_parts.join(", ")));
        }

        output.push(line);
        *line_counter += 1;

        // Process children
        if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
            for child in children {
                output.extend(build_node_string(child, level + 1, line_counter));
            }
        }

        output
    }

    let mut counter = 1;
    let lines = build_node_string(&tree, 1, &mut counter);
    Some(lines.join("\n"))
}

/// Extract window title from a UI tree event
fn extract_window_title_from_ui_tree(event: &WorkflowEventRequest) -> Option<String> {
    // First try from screen data
    if let Some(ref screen) = event.event.screen {
        if let Some(ref title) = screen.window_title {
            if !title.is_empty() {
                return Some(title.clone());
            }
        }
        // Try to extract from UI tree JSON (top-level name attribute)
        if let Ok(tree) = serde_json::from_str::<Value>(&screen.ui_tree) {
            if let Some(name) = tree
                .get("attributes")
                .and_then(|a| a.get("name"))
                .and_then(|n| n.as_str())
            {
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

/// Find the previous UI tree event for the same window
fn find_same_window_ui_tree<'a>(
    event_timestamp: &str,
    window_title: &str,
    ui_tree_events: &'a [&WorkflowEventRequest],
) -> Option<&'a WorkflowEventRequest> {
    ui_tree_events
        .iter()
        .filter(|t| t.timestamp.as_str() < event_timestamp)
        .filter(|t| {
            extract_window_title_from_ui_tree(t)
                .map(|title| title == window_title)
                .unwrap_or(false)
        })
        .max_by_key(|t| &t.timestamp)
        .copied()
}

/// Find all events between two timestamps (exclusive start, inclusive end)
fn find_events_between_timestamps<'a>(
    start_timestamp: &str,
    end_timestamp: &str,
    all_events: &'a [WorkflowEventRequest],
) -> Vec<&'a WorkflowEventRequest> {
    all_events
        .iter()
        .filter(|e| e.timestamp.as_str() > start_timestamp && e.timestamp.as_str() <= end_timestamp)
        .filter(|e| {
            // Filter out ui_tree events, keep action events
            !matches!(e.r#type.as_str(), "ui_tree")
        })
        .collect()
}

/// Compute UI tree diff between two UI tree JSON strings
fn compute_ui_tree_diff(before_json: &str, after_json: &str) -> Option<String> {
    match ui_tree_diff::simple_ui_tree_diff(before_json, after_json) {
        Ok(Some(diff)) => Some(diff),
        Ok(None) => None, // No differences
        Err(e) => {
            debug!("[RECORDING_PROCESSOR] UI tree diff error: {}", e);
            None
        }
    }
}

/// Analyze a single step using Gemini with structured output (with retry for empty responses)
async fn analyze_step(
    event: &WorkflowEventRequest,
    previous_analyses: &[StepAnalysis],
    all_events: &[WorkflowEventRequest],
    ui_tree_events: &[&WorkflowEventRequest],
) -> Result<StepAnalysis, String> {
    const MAX_RETRIES: u32 = 2;

    // Build context for this step (including UI tree context)
    let context = build_step_context(event, previous_analyses, all_events, ui_tree_events);

    // Build prompt
    let prompt = format!(
        "{}\n\nCONTEXT:\n{}",
        recording_prompts::WORKFLOW_STEP_ANALYSIS_PROMPT,
        context
    );

    // Parse the schema for structured output
    let response_schema: serde_json::Value = serde_json::from_str(recording_prompts::STEP_ANALYSIS_SCHEMA)
        .map_err(|e| format!("Failed to parse step analysis schema: {}", e))?;

    // Find screenshot_diff for this event (before/after images)
    let inline_images = find_screenshot_for_event(&event.timestamp, all_events)
        .map(|sd| {
            let images = extract_inline_images(sd);
            info!(
                "[RECORDING_PROCESSOR] Found {} screenshot(s) for step at {}",
                images.len(),
                event.timestamp
            );
            images
        })
        .filter(|images| !images.is_empty());

    let mut last_error = String::new();

    for attempt in 1..=MAX_RETRIES {
        // Call Vertex AI with structured output
        let request = VertexAIRequest {
            model: GEMINI_MODEL.to_string(),
            input: Some(prompt.clone()),
            history: Vec::new(),
            system: None,
            tools: Vec::new(),
            tool_results: None,
            generation_config: Some(GenerationConfig {
                temperature: Some(0.2),
                max_output_tokens: Some(4096),
                response_mime_type: Some("application/json".to_string()),
                response_schema: Some(response_schema.clone()),
            }),
            thinking_level: None,
            mode: None,
            inline_images: inline_images.clone(),
        };

        debug!(
            "[RECORDING_PROCESSOR] Calling Vertex AI (attempt {}/{}) for step analysis (images: {})",
            attempt,
            MAX_RETRIES,
            request.inline_images.as_ref().map(|i| i.len()).unwrap_or(0)
        );

        match vertex_ai::call_vertex_ai(request).await {
            Ok(response) => {
                let text = response.text.trim();

                // Check for empty response
                if text.is_empty() {
                    last_error = "Empty response from Gemini".to_string();
                    if attempt < MAX_RETRIES {
                        warn!(
                            "[RECORDING_PROCESSOR] Empty response, retrying ({}/{})",
                            attempt, MAX_RETRIES
                        );
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        continue;
                    }
                } else {
                    // Still try to extract JSON in case of markdown wrapping
                    let json_str = extract_json(text);

                    match serde_json::from_str::<StepAnalysis>(&json_str) {
                        Ok(mut analysis) => {
                            // Add metadata (not from LLM)
                            analysis.timestamp = event.timestamp.clone();
                            analysis.window_title = extract_window_title(event);
                            return Ok(analysis);
                        }
                        Err(e) => {
                            last_error = format!("Failed to parse step analysis: {} - Response: {}", e, text);
                            if attempt < MAX_RETRIES {
                                warn!(
                                    "[RECORDING_PROCESSOR] Parse error, retrying ({}/{}): {}",
                                    attempt, MAX_RETRIES, e
                                );
                                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                                continue;
                            }
                        }
                    }
                }
            }
            Err(e) => {
                last_error = e.clone();
                if attempt < MAX_RETRIES {
                    warn!(
                        "[RECORDING_PROCESSOR] API error, retrying ({}/{}): {}",
                        attempt, MAX_RETRIES, e
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
            }
        }
    }

    Err(last_error)
}

/// Build context string for step analysis
fn build_step_context(
    event: &WorkflowEventRequest,
    previous_analyses: &[StepAnalysis],
    all_events: &[WorkflowEventRequest],
    ui_tree_events: &[&WorkflowEventRequest],
) -> String {
    let mut context = String::new();

    // Get current window title
    let current_window_title = extract_window_title(event).or_else(|| {
        // Try to get from nearest UI tree
        let (tree_before, _) = find_surrounding_ui_trees(&event.timestamp, ui_tree_events);
        tree_before.and_then(extract_window_title_from_ui_tree)
    });

    // Add current window title (matching web app: currentWindowTitle)
    if let Some(ref title) = current_window_title {
        context.push_str(&format!("CURRENT_WINDOW_TITLE: {}\n", title));
    }

    // Add current event info
    context.push_str("\nCURRENT_EVENT:\n");
    context.push_str(&format!("Type: {}\n", event.r#type));
    context.push_str(&format!("Timestamp: {}\n", event.timestamp));

    // Add event data (simplified)
    if let Some(ref click) = event.event.button_click {
        let pos_str = click
            .click_position
            .as_ref()
            .map(|p| format!("at ({}, {})", p.x, p.y))
            .unwrap_or_else(|| "position unknown".to_string());
        context.push_str(&format!(
            "Click: {} [{}] {}\n",
            click.element_text, click.element_role, pos_str
        ));
    }
    if let Some(ref keyboard) = event.event.keyboard {
        let key_str = keyboard
            .character
            .map(|c| c.to_string())
            .unwrap_or_else(|| format!("keycode:{}", keyboard.key_code));
        context.push_str(&format!("Keyboard: {}\n", key_str));
    }
    if let Some(ref text_input) = event.event.text_input_completed {
        context.push_str(&format!(
            "Text Input: {} -> {}\n",
            text_input.field_name.as_deref().unwrap_or("unknown"),
            text_input.text_value
        ));
    }
    if let Some(ref nav) = event.event.browser_tab_navigation {
        let title = nav.to_title.as_deref().unwrap_or("unknown");
        let url = nav.to_url.as_deref().unwrap_or("unknown");
        context.push_str(&format!("Navigation: {} -> {}\n", title, url));
    }
    if let Some(ref app_switch) = event.event.application_switch {
        let from_app = app_switch
            .from_window_and_application_name
            .as_deref()
            .unwrap_or("unknown");
        let to_app = &app_switch.to_window_and_application_name;
        context.push_str(&format!("App Switch: {} -> {}\n", from_app, to_app));
    }

    // Get surrounding UI trees
    let (tree_before, tree_after) = find_surrounding_ui_trees(&event.timestamp, ui_tree_events);

    // Find same-window UI tree for more relevant diff (matching web app)
    let same_window_tree = current_window_title
        .as_ref()
        .and_then(|title| find_same_window_ui_tree(&event.timestamp, title, ui_tree_events));

    // Add UI tree structure explanation (matching web app)
    context.push_str("\nUI_TREE_STRUCTURE: The UI tree is a simplified representation of the accessibility tree. Each line has the format: 'LineNumber. RomanNumeralIndentation. [Role] 'Name' {Attributes}'.\n");

    // Add current UI tree (simplified format, matching web app: currentUiTree)
    if let Some(after) = tree_after {
        if let Some(ui_tree_json) = extract_ui_tree_string(after) {
            if let Some(simplified) = generate_simplified_ui_tree_string(ui_tree_json) {
                // Truncate if too large
                let truncated = if simplified.len() > 3000 {
                    format!("{}... [truncated]", &simplified[..3000])
                } else {
                    simplified
                };
                context.push_str(&format!("\nCURRENT_UI_TREE:\n{}\n", truncated));
            }
        }
    }

    // Add previous window info (matching web app: previousWindowTitle, previousWindowTimestamp)
    if let Some(before) = tree_before {
        if let Some(prev_title) = extract_window_title_from_ui_tree(before) {
            context.push_str(&format!("\nPREVIOUS_WINDOW_TITLE: {}\n", prev_title));
            context.push_str(&format!(
                "PREVIOUS_WINDOW_TIMESTAMP: {}\n",
                before.timestamp
            ));
        }
    }

    // Add events since previous UI tree (matching web app: eventsSincePreviousUiTreeByTimestamp)
    if let Some(before) = tree_before {
        let events_between = find_events_between_timestamps(&before.timestamp, &event.timestamp, all_events);
        if !events_between.is_empty() {
            context.push_str(&format!(
                "\nEVENTS_SINCE_PREVIOUS_UI_TREE ({} events):\n",
                events_between.len()
            ));
            for (i, evt) in events_between.iter().take(10).enumerate() {
                context.push_str(&format!(
                    "  {}. {} at {}\n",
                    i + 1,
                    evt.r#type,
                    evt.timestamp
                ));
            }
            if events_between.len() > 10 {
                context.push_str(&format!(
                    "  ... and {} more events\n",
                    events_between.len() - 10
                ));
            }
        }
    }

    // Add UI tree diff (matching web app: uiTreeDiffLatestVsPreviousForTheSameWindow)
    // Prefer same-window diff if available, otherwise use any previous tree
    let diff_source = same_window_tree.or(tree_before);
    if let (Some(before_tree), Some(after_tree)) = (diff_source, tree_after) {
        if let (Some(before_json), Some(after_json)) = (
            extract_ui_tree_string(before_tree),
            extract_ui_tree_string(after_tree),
        ) {
            if let Some(diff) = compute_ui_tree_diff(before_json, after_json) {
                // Truncate diff if too large
                let truncated_diff = if diff.len() > 2000 {
                    format!("{}... [truncated]", &diff[..2000])
                } else {
                    diff
                };
                context.push_str(&format!(
                    "\nUI_TREE_DIFF (what changed):\n{}\n",
                    truncated_diff
                ));
            }
        }
    }

    // Add previous analyses (last 3, matching web app: previousAnalyses)
    if !previous_analyses.is_empty() {
        context.push_str("\nPREVIOUS_ANALYSES:\n");
        let start = if previous_analyses.len() > 3 {
            previous_analyses.len() - 3
        } else {
            0
        };
        for (i, analysis) in previous_analyses[start..].iter().enumerate() {
            context.push_str(&format!(
                "{}. {} - {}\n   Intent: {}\n   Clicked: {}\n",
                i + 1,
                analysis.step_title,
                analysis.step_summary,
                analysis.user_intent,
                analysis.what_was_clicked
            ));
        }
    }

    context
}

/// Add a context-aware label to a step
async fn add_label(analyses: &mut Vec<StepAnalysis>, index: usize) -> Result<(), String> {
    if index >= analyses.len() {
        return Err("Index out of bounds".to_string());
    }

    // Build context with neighbors
    let target = &analyses[index];
    let mut neighbor_context = String::new();

    // Get neighbors (up to 5 before and 5 after)
    let start = if index > 5 { index - 5 } else { 0 };
    let end = std::cmp::min(index + 6, analyses.len());

    for i in start..end {
        if i == index {
            continue;
        }
        let a = &analyses[i];
        neighbor_context.push_str(&format!(
            "[{}] {}: {}\n",
            a.timestamp, a.step_title, a.step_summary
        ));
    }

    let prompt = format!(
        "{}\n\nTARGET STEP TO LABEL:\n{}: {}\n\nNEIGHBORING STEPS (for context):\n{}",
        recording_prompts::CONTEXT_AWARE_STEP_LABEL_PROMPT,
        target.step_title,
        target.step_summary,
        neighbor_context
    );

    // Parse the schema for structured output
    let response_schema: serde_json::Value = serde_json::from_str(recording_prompts::LABEL_SUGGESTION_SCHEMA)
        .map_err(|e| format!("Failed to parse label schema: {}", e))?;

    let request = VertexAIRequest {
        model: GEMINI_MODEL.to_string(),
        input: Some(prompt),
        history: Vec::new(),
        system: None,
        tools: Vec::new(),
        tool_results: None,
        generation_config: Some(GenerationConfig {
            temperature: Some(0.2),
            max_output_tokens: Some(1024),
            response_mime_type: Some("application/json".to_string()),
            response_schema: Some(response_schema),
        }),
        thinking_level: None,
        mode: None,
        inline_images: None,
    };

    debug!("[RECORDING_PROCESSOR] Calling Vertex AI with structured output for labeling");
    let response = vertex_ai::call_vertex_ai(request).await?;

    let json_str = extract_json(&response.text);

    #[derive(Deserialize)]
    struct LabelResponse {
        label: String,
    }

    let label_response: LabelResponse =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse label response: {}", e))?;

    analyses[index].label = Some(label_response.label);

    Ok(())
}

/// Synthesize workflow from all analyses using structured output
async fn synthesize_workflow(analyses: &[StepAnalysis]) -> Result<SynthesisResult, String> {
    if analyses.is_empty() {
        return Ok(SynthesisResult {
            workflows: Vec::new(),
        });
    }

    // Build timeline context
    let mut timeline = String::new();
    for (i, analysis) in analyses.iter().enumerate() {
        let label = analysis.label.as_deref().unwrap_or(&analysis.step_title);
        timeline.push_str(&format!(
            "{}. [{}] {} - {} (Intent: {})\n",
            i + 1,
            analysis.timestamp,
            label,
            analysis.step_summary,
            analysis.user_intent
        ));
    }

    let prompt = format!(
        "{}\n\nTIMELINE OF EVENTS:\n{}\n\nGenerate a structured workflow based on these recorded steps.",
        recording_prompts::WORKFLOW_SYNTHESIS_PROMPT,
        timeline
    );

    // Parse the schema for structured output
    let response_schema: serde_json::Value = serde_json::from_str(recording_prompts::WORKFLOW_SYNTHESIS_SCHEMA)
        .map_err(|e| format!("Failed to parse synthesis schema: {}", e))?;

    let request = VertexAIRequest {
        model: GEMINI_MODEL.to_string(),
        input: Some(prompt),
        history: Vec::new(),
        system: None,
        tools: Vec::new(),
        tool_results: None,
        generation_config: Some(GenerationConfig {
            temperature: Some(0.3),
            max_output_tokens: Some(8192),
            response_mime_type: Some("application/json".to_string()),
            response_schema: Some(response_schema),
        }),
        thinking_level: None,
        mode: None,
        inline_images: None,
    };

    debug!("[RECORDING_PROCESSOR] Calling Vertex AI with structured output for synthesis");
    let response = vertex_ai::call_vertex_ai(request).await?;

    let json_str = extract_json(&response.text);

    let result: SynthesisResult = serde_json::from_str(&json_str).map_err(|e| {
        format!(
            "Failed to parse synthesis result: {} - Response: {}",
            e, &response.text
        )
    })?;

    info!(
        "[RECORDING_PROCESSOR] Synthesized {} workflows",
        result.workflows.len()
    );

    Ok(result)
}

/// Generate TypeScript workflow files
async fn generate_typescript_output(
    workflow_folder: &PathBuf,
    synthesis: &SynthesisResult,
    analyses: &[StepAnalysis],
) -> Result<(), String> {
    // Ensure src directory exists
    let src_dir = workflow_folder.join("src");
    let steps_dir = src_dir.join("steps");

    fs::create_dir_all(&steps_dir).map_err(|e| format!("Failed to create steps directory: {}", e))?;

    // Get first workflow (or create default)
    let workflow = synthesis
        .workflows
        .first()
        .cloned()
        .unwrap_or_else(|| SynthesizedWorkflow {
            title: "Recorded Workflow".to_string(),
            description: "Workflow generated from recording session".to_string(),
            steps: Vec::new(),
        });

    // Generate step comments
    let mut step_comments = String::new();
    for (i, analysis) in analyses.iter().enumerate() {
        let label = analysis.label.as_deref().unwrap_or(&analysis.step_title);
        step_comments.push_str(&format!(
            " * {}. {} - {}\n",
            i + 1,
            label,
            analysis.step_summary.replace('\n', " ")
        ));
    }

    // Generate step imports and references
    let mut step_imports = String::new();
    let mut step_references = String::new();
    let mut input_comments = String::new();
    let mut detected_inputs: HashMap<String, String> = HashMap::new();

    for (i, step) in workflow.steps.iter().enumerate() {
        let step_id = format!("step{}_{}", i + 1, to_snake_case(&step.step_name));
        let step_file = format!("{:02}-{}", i + 1, to_kebab_case(&step.step_name));

        step_imports.push_str(&format!(
            "import {{ {} }} from \"./steps/{}\";\n",
            step_id, step_file
        ));

        step_references.push_str(&format!("    {},\n", step_id));

        // Collect inputs from substeps
        for substep in &step.substeps {
            for input in &substep.inputs {
                if !detected_inputs.contains_key(input) {
                    detected_inputs.insert(
                        input.clone(),
                        format!("// Found in step: {}", step.step_name),
                    );
                }
            }
        }

        // Generate step file
        generate_step_file(&steps_dir, &step_file, &step_id, step)?;
    }

    // Build input comments
    for (input, comment) in &detected_inputs {
        input_comments.push_str(&format!("// - {}: {}\n", input, comment));
    }

    // Build input fields
    let mut input_fields = String::new();
    for input in detected_inputs.keys() {
        let field_name = to_camel_case(input);
        input_fields.push_str(&format!(
            "  {}: z.string().optional().describe(\"{}\"),\n",
            field_name, input
        ));
    }

    // Generate main workflow file
    let workflow_id = to_kebab_case(&workflow.title);
    let generation_date = Utc::now().format("%Y-%m-%d").to_string();

    let terminator_path = src_dir.join("terminator.ts");

    // Check if terminator.ts already exists with recorded steps
    // If so, skip overwriting to preserve steps from save_recorded_typescript_workflow
    if terminator_path.exists() {
        if let Ok(existing_content) = fs::read_to_string(&terminator_path) {
            // Check if it has recorded steps (from McpConverter) that we should preserve
            let has_recorded_steps = existing_content.contains("recordedStep")
                || existing_content.contains("recorded-step")
                || existing_content.contains("recorded_step");

            if has_recorded_steps {
                info!(
                    "[RECORDING_PROCESSOR] terminator.ts already has recorded steps, skipping overwrite to preserve them"
                );
                return Ok(());
            }
        }
    }

    let content = recording_prompts::WORKFLOW_TS_TEMPLATE
        .replace("{workflow_name}", &workflow.title)
        .replace("{workflow_description}", &workflow.description)
        .replace("{workflow_id}", &workflow_id)
        .replace("{generation_date}", &generation_date)
        .replace("{step_comments}", &step_comments)
        .replace("{step_imports}", &step_imports)
        .replace("{input_comments}", &input_comments)
        .replace("{input_fields}", &input_fields)
        .replace("{step_references}", &step_references);

    fs::write(&terminator_path, content).map_err(|e| format!("Failed to write terminator.ts: {}", e))?;

    info!(
        "[RECORDING_PROCESSOR] Generated workflow at: {:?}",
        terminator_path
    );

    Ok(())
}

/// Generate markdown analysis output as README.md in workflow root
fn generate_markdown_output(
    workflow_folder: &PathBuf,
    session_id: &str,
    analyses: &[StepAnalysis],
    synthesis: &SynthesisResult,
) -> Result<PathBuf, String> {
    // Write to README.md in workflow root
    let md_path = workflow_folder.join("README.md");

    let mut content = String::new();

    // Header
    content.push_str(&format!("# Recording Analysis\n\n"));
    content.push_str(&format!("**Session ID:** {}\n", session_id));
    content.push_str(&format!(
        "**Generated:** {}\n",
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
    ));
    content.push_str(&format!("**Total Steps Analyzed:** {}\n\n", analyses.len()));

    // Step Analysis Section
    content.push_str("---\n\n");
    content.push_str("## Analyzed Steps\n\n");

    for (i, analysis) in analyses.iter().enumerate() {
        let label = analysis.label.as_deref().unwrap_or(&analysis.step_title);
        content.push_str(&format!("### Step {}: {}\n\n", i + 1, label));
        content.push_str(&format!("**Title:** {}\n\n", analysis.step_title));
        content.push_str(&format!("**Summary:** {}\n\n", analysis.step_summary));
        content.push_str(&format!("**User Intent:** {}\n\n", analysis.user_intent));

        if !analysis.what_was_clicked.is_empty() && analysis.what_was_clicked != "Not available in data" {
            content.push_str(&format!("**Clicked:** {}\n\n", analysis.what_was_clicked));
        }
        if !analysis.what_was_typed.is_empty() && analysis.what_was_typed != "Not available in data" {
            content.push_str(&format!("**Typed:** {}\n\n", analysis.what_was_typed));
        }
        if !analysis.how_content_changed.is_empty() && analysis.how_content_changed != "Not available in data" {
            content.push_str(&format!(
                "**Content Changed:** {}\n\n",
                analysis.how_content_changed
            ));
        }
        if !analysis.results_if_any.is_empty() && analysis.results_if_any != "Not available in data" {
            content.push_str(&format!("**Results:** {}\n\n", analysis.results_if_any));
        }

        if let Some(window) = &analysis.window_title {
            content.push_str(&format!("*Window: {}*\n\n", window));
        }
        content.push_str(&format!("*Timestamp: {}*\n\n", analysis.timestamp));
        content.push_str("---\n\n");
    }

    // Synthesized Workflows Section
    if !synthesis.workflows.is_empty() {
        content.push_str("## Synthesized Workflows\n\n");

        for (w_idx, workflow) in synthesis.workflows.iter().enumerate() {
            content.push_str(&format!(
                "### Workflow {}: {}\n\n",
                w_idx + 1,
                workflow.title
            ));
            content.push_str(&format!("{}\n\n", workflow.description));

            for (s_idx, step) in workflow.steps.iter().enumerate() {
                content.push_str(&format!(
                    "#### Step {}.{}: {}\n\n",
                    w_idx + 1,
                    s_idx + 1,
                    step.step_name
                ));

                for substep in &step.substeps {
                    content.push_str(&format!("- **{}**\n", substep.substep_name));
                    if !substep.inputs.is_empty() {
                        content.push_str(&format!("  - Inputs: {}\n", substep.inputs.join(", ")));
                    }
                    if !substep.outputs.is_empty() {
                        content.push_str(&format!("  - Outputs: {}\n", substep.outputs.join(", ")));
                    }
                    if !substep.business_logic.is_empty() {
                        content.push_str(&format!(
                            "  - Logic: {}\n",
                            substep.business_logic.join("; ")
                        ));
                    }
                }
                content.push_str("\n");
            }
        }
    }

    // Write markdown file
    fs::write(&md_path, &content).map_err(|e| format!("Failed to write markdown analysis: {}", e))?;

    info!(
        "[RECORDING_PROCESSOR] Generated markdown analysis at: {:?}",
        md_path
    );

    Ok(md_path)
}

/// Generate a step file
fn generate_step_file(steps_dir: &PathBuf, step_file: &str, step_id: &str, step: &WorkflowStep) -> Result<(), String> {
    let mut substep_comments = String::new();
    let mut input_list = String::new();
    let mut output_list = String::new();
    let mut logic_list = String::new();
    let mut step_todos = String::new();

    for (i, substep) in step.substeps.iter().enumerate() {
        substep_comments.push_str(&format!("    //   {}. {}\n", i + 1, substep.substep_name));

        for input in &substep.inputs {
            input_list.push_str(&format!("    //   - {}\n", input));
        }
        for output in &substep.outputs {
            output_list.push_str(&format!("    //   - {}\n", output));
        }
        for logic in &substep.business_logic {
            logic_list.push_str(&format!("    //   - {}\n", logic));
        }

        step_todos.push_str(&format!("    // TODO: {}\n", substep.substep_name));
    }

    if input_list.is_empty() {
        input_list = "    //   (none detected)\n".to_string();
    }
    if output_list.is_empty() {
        output_list = "    //   (none detected)\n".to_string();
    }
    if logic_list.is_empty() {
        logic_list = "    //   (none detected)\n".to_string();
    }
    if step_todos.is_empty() {
        step_todos = "    // TODO: Implement this step\n".to_string();
    }

    let content = recording_prompts::STEP_TS_TEMPLATE
        .replace("{step_name}", &step.step_name)
        .replace(
            "{step_description}",
            &format!("Step from recorded workflow"),
        )
        .replace("{step_id}", step_id)
        .replace("{substep_comments}", &substep_comments)
        .replace("{input_list}", &input_list)
        .replace("{output_list}", &output_list)
        .replace("{logic_list}", &logic_list)
        .replace("{step_todos}", &step_todos);

    let path = steps_dir.join(format!("{}.ts", step_file));
    fs::write(&path, content).map_err(|e| format!("Failed to write step file: {}", e))?;

    debug!("[RECORDING_PROCESSOR] Generated step file: {:?}", path);

    Ok(())
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Extract JSON from text that may have markdown code blocks
fn extract_json(text: &str) -> String {
    let trimmed = text.trim();

    // Try to extract from markdown code block
    if trimmed.starts_with("```json") {
        if let Some(end) = trimmed.rfind("```") {
            let start = "```json".len();
            if end > start {
                return trimmed[start..end].trim().to_string();
            }
        }
    }

    if trimmed.starts_with("```") {
        if let Some(end) = trimmed.rfind("```") {
            // Find end of first line (after ```)
            if let Some(newline) = trimmed.find('\n') {
                let start = newline + 1;
                if end > start {
                    return trimmed[start..end].trim().to_string();
                }
            }
        }
    }

    // Just return as-is
    trimmed.to_string()
}

/// Extract window title from event
fn extract_window_title(event: &WorkflowEventRequest) -> Option<String> {
    if let Some(ref click) = event.event.button_click {
        // Use element_text as a proxy for window context
        if !click.element_text.is_empty() {
            return Some(click.element_text.clone());
        }
    }
    if let Some(ref nav) = event.event.browser_tab_navigation {
        return nav.to_title.clone();
    }
    if let Some(ref app_switch) = event.event.application_switch {
        return Some(app_switch.to_window_and_application_name.clone());
    }
    None
}

/// Convert string to snake_case
fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            result.push('_');
        }
        if c.is_alphanumeric() {
            result.push(c.to_lowercase().next().unwrap_or(c));
        } else if c == ' ' || c == '-' {
            result.push('_');
        }
    }
    // Remove consecutive underscores
    let mut prev_underscore = false;
    result
        .chars()
        .filter(|&c| {
            let skip = c == '_' && prev_underscore;
            prev_underscore = c == '_';
            !skip
        })
        .collect()
}

/// Convert string to kebab-case
fn to_kebab_case(s: &str) -> String {
    to_snake_case(s).replace('_', "-")
}

/// Convert string to camelCase
fn to_camel_case(s: &str) -> String {
    let parts: Vec<&str> = s
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return String::new();
    }

    let mut result = parts[0].to_lowercase();
    for part in &parts[1..] {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            result.push(first.to_uppercase().next().unwrap_or(first));
            result.push_str(&chars.collect::<String>().to_lowercase());
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_snake_case() {
        assert_eq!(to_snake_case("Hello World"), "hello_world");
        assert_eq!(to_snake_case("OpenEmailClient"), "open_email_client");
        assert_eq!(to_snake_case("step-one"), "step_one");
    }

    #[test]
    fn test_to_kebab_case() {
        assert_eq!(to_kebab_case("Hello World"), "hello-world");
        assert_eq!(to_kebab_case("OpenEmailClient"), "open-email-client");
    }

    #[test]
    fn test_to_camel_case() {
        assert_eq!(to_camel_case("hello world"), "helloWorld");
        assert_eq!(to_camel_case("open-email-client"), "openEmailClient");
    }

    #[test]
    fn test_extract_json() {
        let text = "```json\n{\"key\": \"value\"}\n```";
        assert_eq!(extract_json(text), "{\"key\": \"value\"}");

        let plain = "{\"key\": \"value\"}";
        assert_eq!(extract_json(plain), "{\"key\": \"value\"}");
    }
}
