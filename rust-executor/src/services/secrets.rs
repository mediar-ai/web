use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Postgres, Row};
use std::collections::HashMap;
use std::env;
use tracing::{error, info, instrument};

const IV_LENGTH: usize = 12; // 96 bits for GCM

/// Get the master encryption key from environment
fn get_master_key() -> Result<Vec<u8>> {
    let key_str = env::var("SECRETS_ENCRYPTION_KEY")
        .map_err(|_| anyhow!("SECRETS_ENCRYPTION_KEY environment variable is not set"))?;

    // Hash the key to get consistent 256-bit key (same as Python implementation)
    let mut hasher = Sha256::new();
    hasher.update(key_str.as_bytes());
    Ok(hasher.finalize().to_vec())
}

/// Decrypt a secret value
///
/// The encrypted value is base64-encoded and contains: IV (12 bytes) + ciphertext + tag
fn decrypt_secret(encrypted_value: &str) -> Result<String> {
    let master_key = get_master_key()?;

    // Decode from base64
    let combined = STANDARD
        .decode(encrypted_value)
        .map_err(|e| anyhow!("Failed to decode base64: {}", e))?;

    if combined.len() < IV_LENGTH {
        return Err(anyhow!("Encrypted value too short"));
    }

    // Extract IV and ciphertext+tag
    let (iv, ciphertext_and_tag) = combined.split_at(IV_LENGTH);

    // Create unbound key and nonce
    let unbound_key = UnboundKey::new(&AES_256_GCM, &master_key)
        .map_err(|e| anyhow!("Failed to create key: {:?}", e))?;
    let key = LessSafeKey::new(unbound_key);
    let nonce =
        Nonce::try_assume_unique_for_key(iv).map_err(|_| anyhow!("Invalid nonce length"))?;

    // Decrypt
    let mut in_out = ciphertext_and_tag.to_vec();
    key.open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| anyhow!("Decryption failed: {:?}", e))?;

    // Remove the tag (last 16 bytes) from the result
    let tag_len = AES_256_GCM.tag_len();
    let plaintext_len = in_out.len().saturating_sub(tag_len);
    in_out.truncate(plaintext_len);

    String::from_utf8(in_out).map_err(|e| anyhow!("Failed to convert to UTF-8: {}", e))
}

/// Load and decrypt all secrets for an organization
///
/// The optional `execution_id` parameter is included in log messages for dashboard log correlation.
/// When an execution_id is provided, it will be included in error/info logs so the dashboard
/// can find these logs when searching by execution ID in ClickHouse.
#[instrument(skip(pool), fields(org_id = %org_id, execution_id = ?execution_id))]
pub async fn load_org_secrets(
    pool: &Pool<Postgres>,
    org_id: &str,
    execution_id: Option<i64>,
) -> Result<HashMap<String, String>> {
    let mut secrets = HashMap::new();

    let rows = sqlx::query(
        r#"
        SELECT name, encrypted_value
        FROM org_secrets
        WHERE org_id = $1
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    for row in rows {
        let name: String = row.get("name");
        let encrypted_value: String = row.get("encrypted_value");

        match decrypt_secret(&encrypted_value) {
            Ok(decrypted_value) => {
                secrets.insert(name.clone(), decrypted_value);
                if let Some(exec_id) = execution_id {
                    info!(execution_id = %exec_id, "Loaded secret: {}", name);
                } else {
                    info!("Loaded secret: {}", name);
                }
            }
            Err(e) => {
                // Include execution_id in error logs so dashboard can find them
                if let Some(exec_id) = execution_id {
                    error!(execution_id = %exec_id, "Failed to decrypt secret {}: {}", name, e);
                } else {
                    error!("Failed to decrypt secret {}: {}", name, e);
                }
                // Continue loading other secrets even if one fails
            }
        }
    }

    Ok(secrets)
}

/// Inject secrets into workflow parameters
///
/// Supports two modes:
/// 1. Placeholder substitution: Replace ${SECRET_NAME} with actual values
/// 2. Direct injection: Add secrets as top-level parameters
pub fn inject_secrets_into_params(
    params: Value,
    secrets: &HashMap<String, String>,
    substitute_placeholders: bool,
) -> Value {
    let mut result = params.clone();

    // Mode 1: Substitute placeholders in existing parameters
    if substitute_placeholders {
        result = substitute_placeholders_recursive(result, secrets);
    }

    // Mode 2: Add secrets as top-level parameters
    // This allows workflows to access secrets directly as variables
    if let Value::Object(ref mut map) = result {
        for (name, value) in secrets {
            // Add secret with original name
            if !map.contains_key(name) {
                map.insert(name.clone(), Value::String(value.clone()));
            }

            // Also add lowercase version for compatibility
            // E.g., APOLLO_API_KEY -> apollo_api_key
            let lowercase_name = name.to_lowercase();
            if !map.contains_key(&lowercase_name) {
                map.insert(lowercase_name, Value::String(value.clone()));
            }
        }
    }

    result
}

/// Redact secret values from workflow output
///
/// Scans JSON output recursively and replaces any occurrence of secret values
/// with `[REDACTED:SECRET_NAME]`. This prevents secrets from leaking through
/// workflow outputs into the database and dashboard UI.
///
/// # Arguments
/// * `output` - The workflow output JSON to redact
/// * `secrets` - HashMap of secret names to their decrypted values
///
/// # Returns
/// The output with all secret values replaced by redaction markers
pub fn redact_secrets_from_output(
    output: Option<Value>,
    secrets: &HashMap<String, String>,
) -> Option<Value> {
    let output = output?;

    if secrets.is_empty() {
        return Some(output);
    }

    // Build a map from secret values to their names for efficient lookup
    // Only include non-empty secrets that are long enough to be meaningful
    let value_to_name: HashMap<&str, &str> = secrets
        .iter()
        .filter(|(_, v)| v.len() >= 4) // Skip very short values to avoid false positives
        .map(|(name, value)| (value.as_str(), name.as_str()))
        .collect();

    if value_to_name.is_empty() {
        return Some(output);
    }

    Some(redact_recursive(output, &value_to_name))
}

/// Recursively redact secret values from JSON
fn redact_recursive(value: Value, secrets: &HashMap<&str, &str>) -> Value {
    match value {
        Value::String(s) => {
            let mut result = s.clone();
            // Sort by length descending to replace longer secrets first
            // This prevents partial matches when one secret contains another
            let mut secrets_vec: Vec<_> = secrets.iter().collect();
            secrets_vec.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

            for (secret_value, secret_name) in secrets_vec {
                if result.contains(*secret_value) {
                    result = result.replace(*secret_value, &format!("[REDACTED:{}]", secret_name));
                }
            }
            Value::String(result)
        }
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                new_map.insert(k, redact_recursive(v, secrets));
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => Value::Array(
            arr.into_iter()
                .map(|v| redact_recursive(v, secrets))
                .collect(),
        ),
        _ => value,
    }
}

/// Recursively substitute ${SECRET_NAME} placeholders in JSON values
fn substitute_placeholders_recursive(value: Value, secrets: &HashMap<String, String>) -> Value {
    match value {
        Value::String(s) => {
            let mut result = s.clone();
            for (name, secret_value) in secrets {
                let placeholder = format!("${{{}}}", name);
                result = result.replace(&placeholder, secret_value);
            }
            Value::String(result)
        }
        Value::Object(map) => {
            let mut new_map = Map::new();
            for (k, v) in map {
                new_map.insert(k, substitute_placeholders_recursive(v, secrets));
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => Value::Array(
            arr.into_iter()
                .map(|v| substitute_placeholders_recursive(v, secrets))
                .collect(),
        ),
        _ => value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_substitute_placeholders() {
        let mut secrets = HashMap::new();
        secrets.insert("GITHUB_TOKEN".to_string(), "ghp_secret123".to_string());
        secrets.insert("API_KEY".to_string(), "key456".to_string());

        let input = json!({
            "token": "${GITHUB_TOKEN}",
            "api_key": "${API_KEY}",
            "nested": {
                "value": "prefix ${GITHUB_TOKEN} suffix"
            },
            "unchanged": "no placeholder here"
        });

        let result = substitute_placeholders_recursive(input, &secrets);

        assert_eq!(result["token"], "ghp_secret123");
        assert_eq!(result["api_key"], "key456");
        assert_eq!(result["nested"]["value"], "prefix ghp_secret123 suffix");
        assert_eq!(result["unchanged"], "no placeholder here");
    }

    #[test]
    fn test_inject_secrets() {
        let mut secrets = HashMap::new();
        secrets.insert("GITHUB_TOKEN".to_string(), "ghp_secret123".to_string());

        let input = json!({
            "existing_param": "value"
        });

        let result = inject_secrets_into_params(input, &secrets, false);

        // Should add both GITHUB_TOKEN and github_token
        assert_eq!(result["existing_param"], "value");
        assert_eq!(result["GITHUB_TOKEN"], "ghp_secret123");
        assert_eq!(result["github_token"], "ghp_secret123");
    }

    #[test]
    fn test_decrypt_secret_roundtrip() {
        // Test data generated by Node.js using the same encryption algorithm:
        // - Key derivation: SHA-256(key_string) -> 32-byte key
        // - Encryption: AES-256-GCM with 12-byte IV
        // - Format: base64(IV + ciphertext + authTag)
        //
        // Generated with:
        // const key = "test_encryption_key_12345";
        // const plaintext = "test_secret_value_123";
        // Derived key (hex): c186d045adbeb0d84f057c0dadf879cb26d15c3e4efc2974c65f46b4e7e44d12
        // IV (hex): 58fd0226dc29766233bb214d
        // Result: IV (12 bytes) + ciphertext (21 bytes) + authTag (16 bytes) -> base64

        std::env::set_var("SECRETS_ENCRYPTION_KEY", "test_encryption_key_12345");

        // This encrypted value was generated using Node.js crypto module
        // with the key "test_encryption_key_12345" and plaintext "test_secret_value_123"
        let encrypted = "WP0CJtwpdmIzuyFNU6JwJKyC0UovrqrfMv1DdL8AqqjhclSIcY2oYk/Ka5CBkkxotg==";

        let result = decrypt_secret(encrypted);
        assert!(result.is_ok(), "Decryption failed: {:?}", result.err());
        assert_eq!(result.unwrap(), "test_secret_value_123");
    }

    #[test]
    fn test_decrypt_secret_invalid_base64() {
        std::env::set_var("SECRETS_ENCRYPTION_KEY", "test_key");

        let result = decrypt_secret("not-valid-base64!!!");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("base64"));
    }

    #[test]
    fn test_decrypt_secret_too_short() {
        std::env::set_var("SECRETS_ENCRYPTION_KEY", "test_key");

        // Valid base64 but too short (less than 12 bytes IV)
        let result = decrypt_secret("dG9vX3Nob3J0"); // "too_short" in base64
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too short"));
    }

    #[test]
    fn test_decrypt_secret_wrong_key() {
        // Use a different key than what was used to encrypt
        std::env::set_var("SECRETS_ENCRYPTION_KEY", "wrong_key_entirely");

        // This was encrypted with "test_encryption_key_12345"
        let encrypted = "WP0CJtwpdmIzuyFNU6JwJKyC0UovrqrfMv1DdL8AqqjhclSIcY2oYk/Ka5CBkkxotg==";

        let result = decrypt_secret(encrypted);
        assert!(result.is_err());
        // Should fail with decryption error (authentication tag won't match)
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Decryption failed"));
    }

    // ==================== Redaction Tests ====================

    #[test]
    fn test_redact_secrets_basic() {
        let mut secrets = HashMap::new();
        secrets.insert("GITHUB_TOKEN".to_string(), "ghp_secret123".to_string());
        secrets.insert("API_KEY".to_string(), "sk-key456789".to_string());

        let output = json!({
            "result": "success",
            "token": "ghp_secret123",
            "message": "Used API key sk-key456789 for request"
        });

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        assert_eq!(redacted["result"], "success");
        assert_eq!(redacted["token"], "[REDACTED:GITHUB_TOKEN]");
        assert_eq!(
            redacted["message"],
            "Used API key [REDACTED:API_KEY] for request"
        );
    }

    #[test]
    fn test_redact_secrets_nested() {
        let mut secrets = HashMap::new();
        secrets.insert("PASSWORD".to_string(), "super_secret_pw".to_string());

        let output = json!({
            "data": {
                "nested": {
                    "credentials": {
                        "password": "super_secret_pw"
                    }
                }
            },
            "logs": ["Login with super_secret_pw", "Done"]
        });

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        assert_eq!(
            redacted["data"]["nested"]["credentials"]["password"],
            "[REDACTED:PASSWORD]"
        );
        assert_eq!(redacted["logs"][0], "Login with [REDACTED:PASSWORD]");
        assert_eq!(redacted["logs"][1], "Done");
    }

    #[test]
    fn test_redact_secrets_multiple_occurrences() {
        let mut secrets = HashMap::new();
        secrets.insert("TOKEN".to_string(), "abc123xyz".to_string());

        let output = json!({
            "first": "abc123xyz",
            "second": "prefix abc123xyz suffix abc123xyz end"
        });

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        assert_eq!(redacted["first"], "[REDACTED:TOKEN]");
        assert_eq!(
            redacted["second"],
            "prefix [REDACTED:TOKEN] suffix [REDACTED:TOKEN] end"
        );
    }

    #[test]
    fn test_redact_secrets_empty_secrets() {
        let secrets = HashMap::new();

        let output = json!({
            "data": "some_value"
        });

        let redacted = redact_secrets_from_output(Some(output.clone()), &secrets).unwrap();
        assert_eq!(redacted, output);
    }

    #[test]
    fn test_redact_secrets_none_output() {
        let mut secrets = HashMap::new();
        secrets.insert("TOKEN".to_string(), "secret".to_string());

        let result = redact_secrets_from_output(None, &secrets);
        assert!(result.is_none());
    }

    #[test]
    fn test_redact_secrets_short_values_ignored() {
        let mut secrets = HashMap::new();
        secrets.insert("SHORT".to_string(), "abc".to_string()); // Only 3 chars, should be ignored
        secrets.insert("LONG".to_string(), "abcdefgh".to_string()); // 8 chars, should be redacted

        let output = json!({
            "short_match": "abc",
            "long_match": "abcdefgh"
        });

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        // Short secret should NOT be redacted (too many false positives)
        assert_eq!(redacted["short_match"], "abc");
        // Long secret should be redacted
        assert_eq!(redacted["long_match"], "[REDACTED:LONG]");
    }

    #[test]
    fn test_redact_secrets_overlapping_values() {
        let mut secrets = HashMap::new();
        secrets.insert("FULL_KEY".to_string(), "secret_key_12345".to_string());
        secrets.insert("PARTIAL".to_string(), "secret".to_string());

        let output = json!({
            "value": "secret_key_12345"
        });

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        // Should redact the longer match first
        assert_eq!(redacted["value"], "[REDACTED:FULL_KEY]");
    }

    #[test]
    fn test_redact_secrets_preserves_non_strings() {
        let mut secrets = HashMap::new();
        secrets.insert("TOKEN".to_string(), "secret123".to_string());

        let output = json!({
            "count": 42,
            "enabled": true,
            "ratio": 3.14,
            "nothing": null,
            "token": "secret123"
        });

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        assert_eq!(redacted["count"], 42);
        assert_eq!(redacted["enabled"], true);
        assert_eq!(redacted["ratio"], 3.14);
        assert_eq!(redacted["nothing"], Value::Null);
        assert_eq!(redacted["token"], "[REDACTED:TOKEN]");
    }

    #[test]
    fn test_redact_secrets_in_arrays() {
        let mut secrets = HashMap::new();
        secrets.insert("SECRET".to_string(), "hidden_value".to_string());

        let output = json!([
            "normal",
            "hidden_value",
            {"nested": "hidden_value"},
            ["hidden_value", "other"]
        ]);

        let redacted = redact_secrets_from_output(Some(output), &secrets).unwrap();

        assert_eq!(redacted[0], "normal");
        assert_eq!(redacted[1], "[REDACTED:SECRET]");
        assert_eq!(redacted[2]["nested"], "[REDACTED:SECRET]");
        assert_eq!(redacted[3][0], "[REDACTED:SECRET]");
        assert_eq!(redacted[3][1], "other");
    }
}
