//! Cancellation system for workflow executions
//!
//! Provides a centralized registry for tracking running executions and
//! signaling cancellation requests.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{watch, RwLock};
use tracing::{debug, info, warn};

/// Error types for cancellation operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CancellationError {
    /// Execution not found in registry
    NotFound(i64),
    /// Execution already cancelled
    AlreadyCancelled(i64),
    /// Execution already completed
    AlreadyCompleted(i64),
}

impl std::fmt::Display for CancellationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CancellationError::NotFound(id) => write!(f, "Execution {} not found in registry", id),
            CancellationError::AlreadyCancelled(id) => {
                write!(f, "Execution {} already cancelled", id)
            }
            CancellationError::AlreadyCompleted(id) => {
                write!(f, "Execution {} already completed", id)
            }
        }
    }
}

impl std::error::Error for CancellationError {}

/// A token that can be used to check if an execution has been cancelled
#[derive(Clone)]
pub struct CancellationToken {
    execution_id: i64,
    receiver: watch::Receiver<bool>,
}

impl CancellationToken {
    /// Check if cancellation has been requested
    pub fn is_cancelled(&self) -> bool {
        *self.receiver.borrow()
    }

    /// Wait until cancellation is requested
    /// Returns immediately if already cancelled
    pub async fn cancelled(&mut self) {
        // If already cancelled, return immediately
        if *self.receiver.borrow() {
            return;
        }

        // Wait for the value to change to true
        loop {
            if self.receiver.changed().await.is_err() {
                // Channel closed, treat as cancelled
                return;
            }
            if *self.receiver.borrow() {
                return;
            }
        }
    }

    /// Get the execution ID associated with this token
    pub fn execution_id(&self) -> i64 {
        self.execution_id
    }
}

/// Internal state for a registered execution
struct ExecutionState {
    sender: watch::Sender<bool>,
    cancelled: bool,
    completed: bool,
}

/// Registry for tracking running executions and their cancellation state
#[derive(Clone)]
pub struct CancellationRegistry {
    executions: Arc<RwLock<HashMap<i64, ExecutionState>>>,
}

impl Default for CancellationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl CancellationRegistry {
    /// Create a new cancellation registry
    pub fn new() -> Self {
        Self {
            executions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register an execution and get a cancellation token
    pub async fn register(&self, execution_id: i64) -> CancellationToken {
        let (sender, receiver) = watch::channel(false);

        let state = ExecutionState {
            sender,
            cancelled: false,
            completed: false,
        };

        let mut executions = self.executions.write().await;
        executions.insert(execution_id, state);

        debug!(
            execution_id = %execution_id,
            "Registered execution in cancellation registry"
        );

        CancellationToken {
            execution_id,
            receiver,
        }
    }

    /// Request cancellation of an execution
    pub async fn cancel(&self, execution_id: i64) -> Result<(), CancellationError> {
        let mut executions = self.executions.write().await;

        match executions.get_mut(&execution_id) {
            Some(state) => {
                if state.completed {
                    return Err(CancellationError::AlreadyCompleted(execution_id));
                }
                if state.cancelled {
                    return Err(CancellationError::AlreadyCancelled(execution_id));
                }

                state.cancelled = true;

                // Signal cancellation to all token holders
                if state.sender.send(true).is_err() {
                    warn!(
                        execution_id = %execution_id,
                        "No receivers for cancellation signal"
                    );
                }

                info!(
                    execution_id = %execution_id,
                    "Cancellation signaled for execution"
                );

                Ok(())
            }
            None => Err(CancellationError::NotFound(execution_id)),
        }
    }

    /// Mark an execution as completed and remove it from the registry
    pub async fn complete(&self, execution_id: i64) {
        let mut executions = self.executions.write().await;

        if let Some(state) = executions.get_mut(&execution_id) {
            state.completed = true;
        }

        // Remove from registry
        executions.remove(&execution_id);

        debug!(
            execution_id = %execution_id,
            "Removed execution from cancellation registry"
        );
    }

    /// Check if an execution is registered
    pub async fn is_registered(&self, execution_id: i64) -> bool {
        let executions = self.executions.read().await;
        executions.contains_key(&execution_id)
    }

    /// Check if an execution has been cancelled
    pub async fn is_cancelled(&self, execution_id: i64) -> Option<bool> {
        let executions = self.executions.read().await;
        executions.get(&execution_id).map(|state| state.cancelled)
    }

    /// Get the number of registered executions
    pub async fn len(&self) -> usize {
        let executions = self.executions.read().await;
        executions.len()
    }

    /// Check if registry is empty
    pub async fn is_empty(&self) -> bool {
        let executions = self.executions.read().await;
        executions.is_empty()
    }

    /// Get all registered execution IDs
    pub async fn execution_ids(&self) -> Vec<i64> {
        let executions = self.executions.read().await;
        executions.keys().copied().collect()
    }

    /// Clean up old entries (safety measure)
    /// Returns the number of entries removed
    pub async fn cleanup_stale(&self, max_entries: usize) -> usize {
        let mut executions = self.executions.write().await;

        if executions.len() <= max_entries {
            return 0;
        }

        // Remove completed entries first
        let completed_ids: Vec<i64> = executions
            .iter()
            .filter(|(_, state)| state.completed)
            .map(|(id, _)| *id)
            .collect();

        for id in &completed_ids {
            executions.remove(id);
        }

        let removed = completed_ids.len();
        if removed > 0 {
            warn!(
                removed = %removed,
                "Cleaned up stale entries from cancellation registry"
            );
        }

        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    #[tokio::test]
    async fn test_register_and_check() {
        let registry = CancellationRegistry::new();

        let token = registry.register(123).await;

        assert!(registry.is_registered(123).await);
        assert!(!token.is_cancelled());
        assert_eq!(registry.len().await, 1);
    }

    #[tokio::test]
    async fn test_cancel_execution() {
        let registry = CancellationRegistry::new();

        let token = registry.register(456).await;
        assert!(!token.is_cancelled());

        let result = registry.cancel(456).await;
        assert!(result.is_ok());
        assert!(token.is_cancelled());

        // Check registry state
        assert_eq!(registry.is_cancelled(456).await, Some(true));
    }

    #[tokio::test]
    async fn test_cancel_not_found() {
        let registry = CancellationRegistry::new();

        let result = registry.cancel(999).await;
        assert!(matches!(result, Err(CancellationError::NotFound(999))));
    }

    #[tokio::test]
    async fn test_cancel_already_cancelled() {
        let registry = CancellationRegistry::new();

        let _token = registry.register(789).await;

        // First cancellation should succeed
        let result1 = registry.cancel(789).await;
        assert!(result1.is_ok());

        // Second cancellation should fail
        let result2 = registry.cancel(789).await;
        assert!(matches!(
            result2,
            Err(CancellationError::AlreadyCancelled(789))
        ));
    }

    #[tokio::test]
    async fn test_complete_removes_from_registry() {
        let registry = CancellationRegistry::new();

        let _token = registry.register(111).await;
        assert!(registry.is_registered(111).await);

        registry.complete(111).await;
        assert!(!registry.is_registered(111).await);
        assert_eq!(registry.len().await, 0);
    }

    #[tokio::test]
    async fn test_cancel_after_complete() {
        let registry = CancellationRegistry::new();

        let _token = registry.register(222).await;
        registry.complete(222).await;

        // Should fail because execution was removed
        let result = registry.cancel(222).await;
        assert!(matches!(result, Err(CancellationError::NotFound(222))));
    }

    #[tokio::test]
    async fn test_multiple_tokens_same_execution() {
        let registry = CancellationRegistry::new();

        let token1 = registry.register(333).await;

        // Clone the token (simulating passing to another task)
        let token2 = token1.clone();

        assert!(!token1.is_cancelled());
        assert!(!token2.is_cancelled());

        registry.cancel(333).await.unwrap();

        // Both tokens should see cancellation
        assert!(token1.is_cancelled());
        assert!(token2.is_cancelled());
    }

    #[tokio::test]
    async fn test_token_cancelled_await() {
        let registry = CancellationRegistry::new();

        let mut token = registry.register(444).await;

        // Spawn a task that will cancel after a short delay
        let registry_clone = registry.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            registry_clone.cancel(444).await.unwrap();
        });

        // Wait for cancellation with timeout
        let result = timeout(Duration::from_secs(1), token.cancelled()).await;
        assert!(result.is_ok(), "Should have received cancellation signal");
    }

    #[tokio::test]
    async fn test_token_cancelled_immediate() {
        let registry = CancellationRegistry::new();

        let mut token = registry.register(555).await;

        // Cancel immediately
        registry.cancel(555).await.unwrap();

        // Should return immediately since already cancelled
        let result = timeout(Duration::from_millis(10), token.cancelled()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_execution_ids() {
        let registry = CancellationRegistry::new();

        registry.register(1).await;
        registry.register(2).await;
        registry.register(3).await;

        let mut ids = registry.execution_ids().await;
        ids.sort();

        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn test_cleanup_stale() {
        let registry = CancellationRegistry::new();

        // Register several executions
        for i in 1..=10 {
            registry.register(i).await;
        }

        // Mark some as completed
        for i in 1..=5 {
            let mut executions = registry.executions.write().await;
            if let Some(state) = executions.get_mut(&i) {
                state.completed = true;
            }
        }

        // Cleanup with threshold of 3 (should remove completed ones)
        let removed = registry.cleanup_stale(3).await;
        assert_eq!(removed, 5);
        assert_eq!(registry.len().await, 5);
    }

    #[tokio::test]
    async fn test_concurrent_cancellations() {
        let registry = CancellationRegistry::new();

        // Register multiple executions
        let token1 = registry.register(1).await;
        let token2 = registry.register(2).await;
        let token3 = registry.register(3).await;
        let token4 = registry.register(4).await;
        let token5 = registry.register(5).await;
        let tokens = vec![token1, token2, token3, token4, token5];

        // Cancel all
        for i in 1..=5 {
            let result = registry.cancel(i).await;
            assert!(result.is_ok());
        }

        // All tokens should be cancelled
        for token in &tokens {
            assert!(token.is_cancelled());
        }
    }

    #[tokio::test]
    async fn test_registry_clone() {
        let registry = CancellationRegistry::new();
        let registry_clone = registry.clone();

        let token = registry.register(666).await;

        // Cancel via clone
        registry_clone.cancel(666).await.unwrap();

        // Token should see cancellation
        assert!(token.is_cancelled());

        // Both registries should see the same state
        assert_eq!(registry.is_cancelled(666).await, Some(true));
        assert_eq!(registry_clone.is_cancelled(666).await, Some(true));
    }
}
