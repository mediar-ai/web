use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use serde_json::{Value, Map};
use sqlx::{Pool, Postgres, Row};
use std::collections::HashMap;
use std::env;
use sha2::{Sha256, Digest};
use tracing::{error, info, warn};

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
    let combined = STANDARD.decode(encrypted_value)
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
    let nonce = Nonce::try_assume_unique_for_key(iv)
        .map_err(|_| anyhow!("Invalid nonce length"))?;

    // Decrypt
    let mut in_out = ciphertext_and_tag.to_vec();
    key.open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| anyhow!("Decryption failed: {:?}", e))?;

    // Remove the tag (last 16 bytes) from the result
    let tag_len = AES_256_GCM.tag_len();
    let plaintext_len = in_out.len().saturating_sub(tag_len);
    in_out.truncate(plaintext_len);

    String::from_utf8(in_out)
        .map_err(|e| anyhow!("Failed to convert to UTF-8: {}", e))
}

/// Load and decrypt all secrets for an organization
pub async fn load_org_secrets(pool: &Pool<Postgres>, org_id: &str) -> Result<HashMap<String, String>> {
    let mut secrets = HashMap::new();

    let rows = sqlx::query(
        r#"
        SELECT name, encrypted_value
        FROM org_secrets
        WHERE org_id = $1
        "#
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
                info!("Loaded secret: {}", name);
            }
            Err(e) => {
                error!("Failed to decrypt secret {}: {}", name, e);
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
        Value::Array(arr) => {
            Value::Array(arr.into_iter().map(|v| substitute_placeholders_recursive(v, secrets)).collect())
        }
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
}
