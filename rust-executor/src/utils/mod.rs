use anyhow::Result;
use serde_json::Value;

/// Normalize an endpoint URL by removing trailing slashes
pub fn normalize_endpoint(url: &str) -> String {
    let mut normalized = url.trim().to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

/// Merge two JSON objects, with values from `override_obj` taking precedence
pub fn merge_json_objects(base: &Value, override_obj: &Value) -> Result<Value> {
    if !base.is_object() || !override_obj.is_object() {
        return Ok(override_obj.clone());
    }

    let mut result = base.clone();
    if let (Some(base_obj), Some(override_map)) = (result.as_object_mut(), override_obj.as_object())
    {
        for (key, value) in override_map {
            base_obj.insert(key.clone(), value.clone());
        }
    }

    Ok(result)
}

/// Generate a unique request ID for tracing
pub fn generate_request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_normalize_endpoint() {
        assert_eq!(
            normalize_endpoint("http://example.com/"),
            "http://example.com"
        );
        assert_eq!(
            normalize_endpoint("http://example.com///"),
            "http://example.com"
        );
        assert_eq!(
            normalize_endpoint("http://example.com"),
            "http://example.com"
        );
    }

    #[test]
    fn test_merge_json_objects() {
        let base = json!({
            "a": 1,
            "b": 2,
        });

        let override_obj = json!({
            "b": 3,
            "c": 4,
        });

        let merged = merge_json_objects(&base, &override_obj).unwrap();
        assert_eq!(
            merged,
            json!({
                "a": 1,
                "b": 3,
                "c": 4,
            })
        );
    }

    #[test]
    fn test_generate_request_id() {
        let id1 = generate_request_id();
        let id2 = generate_request_id();
        assert_ne!(id1, id2);
        assert_eq!(id1.len(), 36); // UUID v4 with dashes
    }
}
