use serde_json::Value;
use similar::{ChangeTag, TextDiff};

/// Remove volatile attributes from DOM elements (positions, dimensions)
/// These change frequently and aren't useful for diff
pub fn remove_volatile_dom_attributes(value: &Value) -> Value {
    match value {
        Value::Array(arr) => Value::Array(arr.iter().map(remove_volatile_dom_attributes).collect()),
        Value::Object(obj) => {
            let mut new_obj = serde_json::Map::new();
            for (key, val) in obj.iter() {
                // Skip volatile fields that change frequently
                // Keep structural and semantic fields
                if key != "x" && key != "y" && key != "width" && key != "height" {
                    // For value field, only skip if it's an input element (type field exists)
                    if key == "value" && obj.contains_key("type") {
                        // Skip input values as they're captured in events
                        continue;
                    }
                    new_obj.insert(key.clone(), remove_volatile_dom_attributes(val));
                }
            }
            Value::Object(new_obj)
        }
        _ => value.clone(),
    }
}

/// Preprocess DOM tree by removing volatile fields
pub fn preprocess_dom_tree(dom_json: &str) -> Result<String, String> {
    // Parse JSON
    let tree: Value = serde_json::from_str(dom_json).map_err(|e| format!("Failed to parse DOM tree JSON: {e}"))?;

    // Remove volatile attributes
    let cleaned_tree = remove_volatile_dom_attributes(&tree);

    // Pretty print for diffing
    serde_json::to_string_pretty(&cleaned_tree).map_err(|e| format!("Failed to serialize cleaned DOM tree: {e}"))
}

/// Compute DOM tree diff using line-based diffing
/// Similar to UI tree diff but for DOM elements
pub fn simple_dom_tree_diff(old_dom_str: &str, new_dom_str: &str) -> Result<Option<String>, String> {
    // Preprocess both DOM trees to remove volatile fields
    let old_processed = preprocess_dom_tree(old_dom_str)?;
    let new_processed = preprocess_dom_tree(new_dom_str)?;

    // Compute line-based diff
    let diff = TextDiff::from_lines(&old_processed, &new_processed);

    let mut changed_lines = Vec::new();
    let mut context_lines = 0;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Delete => {
                changed_lines.push(format!("- {}", change.value().trim_end()));
                context_lines = 0;
            }
            ChangeTag::Insert => {
                changed_lines.push(format!("+ {}", change.value().trim_end()));
                context_lines = 0;
            }
            ChangeTag::Equal => {
                // Include up to 2 lines of context around changes
                if context_lines < 2 && !changed_lines.is_empty() {
                    changed_lines.push(format!("  {}", change.value().trim_end()));
                    context_lines += 1;
                }
            }
        }
    }

    if changed_lines.is_empty() {
        Ok(None)
    } else {
        // Limit output to reasonable size
        let output = if changed_lines.len() > 50 {
            let mut truncated = changed_lines[..50].to_vec();
            truncated.push(format!("... ({} more lines)", changed_lines.len() - 50));
            truncated.join("\n")
        } else {
            changed_lines.join("\n")
        };
        Ok(Some(output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_remove_volatile_attributes() {
        let input = json!({
            "elements": [
                {
                    "tag": "button",
                    "id": "submit",
                    "text": "Submit",
                    "x": 100,
                    "y": 200,
                    "width": 80,
                    "height": 30
                }
            ]
        });

        let result = remove_volatile_dom_attributes(&input);
        let result_obj = result.as_object().unwrap();
        let elements = result_obj.get("elements").unwrap().as_array().unwrap();
        let element = elements[0].as_object().unwrap();

        assert!(element.contains_key("tag"));
        assert!(element.contains_key("id"));
        assert!(element.contains_key("text"));
        assert!(!element.contains_key("x"));
        assert!(!element.contains_key("y"));
        assert!(!element.contains_key("width"));
        assert!(!element.contains_key("height"));
    }

    #[test]
    fn test_dom_diff_no_changes() {
        let dom1 = r#"{"elements": [{"tag": "div", "id": "test", "x": 100}]}"#;
        let dom2 = r#"{"elements": [{"tag": "div", "id": "test", "x": 200}]}"#;

        let diff = simple_dom_tree_diff(dom1, dom2).unwrap();
        assert!(diff.is_none()); // Position changes are ignored
    }

    #[test]
    fn test_dom_diff_with_changes() {
        let dom1 = r#"{"elements": [{"tag": "div", "id": "test", "text": "Hello"}]}"#;
        let dom2 = r#"{"elements": [{"tag": "div", "id": "test", "text": "World"}]}"#;

        let diff = simple_dom_tree_diff(dom1, dom2).unwrap();
        assert!(diff.is_some());
        let diff_text = diff.unwrap();
        assert!(diff_text.contains("Hello"));
        assert!(diff_text.contains("World"));
    }
}
