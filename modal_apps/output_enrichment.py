from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional


def resolve_enrichment_policy(
    execution_params: Optional[Dict[str, Any]],
    automation_sequence: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Decide whether to run enrichment and with what configuration.

    Precedence:
    1) execution_params.enrich_output / execution_params.enrichment
    2) workflow default from sequence.arguments.mediar_parser.schema
    3) otherwise disabled
    """
    params = execution_params or {}
    enrichment_block = params.get("enrichment") if isinstance(params, dict) else None
    enrich_flag = params.get("enrich_output") if isinstance(params, dict) else None

    # Check workflow defaults (STRICT): only arguments.mediar_parser.schema is supported
    default_schema = None
    if automation_sequence and isinstance(automation_sequence, dict):
        args = automation_sequence.get("arguments", {})
        if isinstance(args, dict):
            mediar_parser_cfg = args.get("mediar_parser")
            if isinstance(mediar_parser_cfg, dict):
                default_schema = mediar_parser_cfg.get("schema")

    # Decide enablement
    enabled = bool(enrich_flag) or (default_schema is not None)
    if not enabled:
        return None

    # Build config
    config: Dict[str, Any] = {
        "mode": (enrichment_block or {}).get("mode", "sync"),
        "model": (enrichment_block or {}).get("model", "gemini-2.5-flash"),
        "schema": (enrichment_block or {}).get("schema", default_schema),
        "instructions": (enrichment_block or {}).get(
            "instructions",
            "Extract structured data from the provided content according to the schema. Return ONLY valid JSON matching the schema.",
        ),
        "temperature": (enrichment_block or {}).get("temperature", 0.1),
        "max_tokens": (enrichment_block or {}).get("max_tokens", 1000),
        "use_default_system_prompt": (enrichment_block or {}).get("use_default_system_prompt", True),
        # Allow caller to choose where to store structured output within results
        # default is "mediar_parser" per app convention
        "output_key": (enrichment_block or {}).get("output_key", "mediar_parser"),
    }

    # If no schema is available at all, disable
    if not config.get("schema"):
        return None

    return config


DEFAULT_ENRICHMENT_SYSTEM_PROMPT = (
    "You are a deterministic information extraction agent.\n"
    "Task: Extract only the fields defined by the provided JSON schema.\n"
    "Requirements:\n"
    "- Output MUST be valid JSON that strictly matches the schema.\n"
    "- Do NOT include any commentary or extra keys.\n"
    "- Prefer monthly price values; ignore quarterly/semi-annual/annual unless instructed otherwise.\n"
    "- Normalize monthly-like labels (e.g., MONTHLY, monthly, MONTHLY-EFT) under the same monthly concept.\n"
    "- Map statuses consistently (e.g., Discontinued, Ineligible/Excluded, Available, Unknown).\n"
    "- If a field cannot be confidently extracted without violating the schema, SKIP that item.\n"
)


def detect_mime_type(text: Any) -> str:
    if not isinstance(text, str):
        return "text/plain"
    lower = text.strip().lower()
    if "<html" in lower or "</html>" in lower:
        return "text/html"
    return "text/plain"


def to_snake_case(key: str) -> str:
    """Convert a string from camelCase/PascalCase/kebab-case/space case to snake_case.

    This is conservative: if input is already snake_case, it is returned as-is.
    """
    if not isinstance(key, str) or not key:
        return key

    # Normalize separators to spaces first
    normalized = re.sub(r"[-\s]+", "_", key.strip())

    # Handle camelCase/PascalCase boundaries
    # e.g. "carrierProduct" -> "carrier_Product" -> "carrier_product"
    step1 = re.sub(r"(.)([A-Z][a-z0-9]+)", r"\1_\2", normalized)
    # e.g. "URLId" -> "URL_Id" -> "url_id"
    step2 = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", step1)
    snake = step2.replace("__", "_").lower()
    return snake


def to_camel_case(key: str) -> str:
    """Convert a string from snake_case/kebab-case/space case to camelCase.

    If the input already appears to be camelCase (contains at least one capital
    and no separators), it is returned as-is to avoid destructive changes.
    """
    if not isinstance(key, str) or not key:
        return key

    # Quick heuristic: treat as camelCase if no separators and has an uppercase
    if re.match(r"^[a-z]+(?:[A-Z][a-z0-9]+)*$", key):
        return key

    # Normalize separators to underscores, split, then build camelCase
    parts = re.sub(r"[-\s]+", "_", key.strip()).split("_")
    parts = [p for p in parts if p]
    if not parts:
        return key
    first = parts[0].lower()
    rest = [p[:1].upper() + p[1:].lower() if p else "" for p in parts[1:]]
    return first + "".join(rest)


def add_dual_case_keys_inplace(node: Any) -> Any:
    """Recursively ensure dictionaries contain both snake_case and camelCase keys.

    - For each dict key, we compute both forms and add the missing alias if absent.
    - Lists are processed element-wise.
    - Non-collection values are returned unchanged.
    - Original values are preserved; aliases are only added if missing.
    """
    if isinstance(node, list):
        for i in range(len(node)):
            node[i] = add_dual_case_keys_inplace(node[i])
        return node

    if isinstance(node, dict):
        # First, process children so both aliases (if added) point to processed nodes
        for k in list(node.keys()):
            node[k] = add_dual_case_keys_inplace(node[k])

        # Then, add aliases for each key
        original_keys = list(node.keys())
        for key in original_keys:
            camel = to_camel_case(key)
            snake = to_snake_case(key)

            # Add camelCase alias if missing
            if camel and camel not in node:
                node[camel] = node[key]

            # Add snake_case alias if missing
            if snake and snake not in node:
                node[snake] = node[key]

        return node

    return node


def derive_raw_payload_from_results(results: Dict[str, Any]) -> Optional[str]:
    """Try to extract a raw textual payload suitable for LLM parsing.

    Preference order:
    1) Direct text from step details content items
    2) String-like extracted_data
    3) Quotes joined (as text) if present
    4) raw_mcp_response content text
    5) Fallback to serialized results
    """
    try:
        # 1) step_details content text
        step_details = results.get("step_details")
        if isinstance(step_details, list):
            for group in step_details:
                if isinstance(group, dict) and isinstance(group.get("results"), list):
                    for step in group["results"]:
                        content = step.get("result", {}).get("content") if isinstance(step, dict) else None
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                                    return item["text"]

        # 2) extracted_data (string)
        extracted = results.get("extracted_data")
        if isinstance(extracted, str) and extracted.strip():
            return extracted

        # 3) quotes as joined text
        quotes = results.get("quotes")
        if isinstance(quotes, list) and quotes:
            joined = "\n".join([json.dumps(q, ensure_ascii=False) if not isinstance(q, str) else q for q in quotes])
            if joined.strip():
                return joined

        # 4) raw_mcp_response content text
        raw_mcp = results.get("raw_mcp_response")
        if isinstance(raw_mcp, dict):
            try:
                content_list = raw_mcp.get("result", {}).get("content", [])
                if isinstance(content_list, list) and content_list:
                    first_text = next((c.get("text") for c in content_list if isinstance(c, dict) and isinstance(c.get("text"), str)), None)
                    if first_text:
                        return first_text
            except Exception:
                pass

        # 5) fallback to serialized results
        return json.dumps(results, ensure_ascii=False)
    except Exception:
        return None


def _hash_schema(schema: Any) -> str:
    import hashlib

    try:
        payload = json.dumps(schema, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()
    except Exception:
        return "unknown"


def enrich_with_ai(raw_text: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Use Google GenAI SDK (preferred) with Vertex routing to extract JSON.

    Falls back to Vertex AI Python SDK if google-genai is unavailable.

    Env:
    - GOOGLE_APPLICATION_CREDENTIALS_BASE64 (service account JSON, base64)
    - GOOGLE_CLOUD_PROJECT
    - VERTEX_AI_LOCATION (or GOOGLE_CLOUD_LOCATION), defaults to us-central1
    - GOOGLE_GENAI_USE_VERTEXAI=True (set when using google-genai)
    """
    # Preferred: google-genai per official docs
    try:
        from google import genai
        from google.genai.types import GenerateContentConfig, HttpOptions

        creds_b64 = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_BASE64")
        if not creds_b64:
            return {"ok": False, "error": "Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64 env var"}
        sa_json = base64.b64decode(creds_b64).decode("utf-8")
        cred_path = os.path.join(os.getcwd(), ".tmp_sa.json")
        with open(cred_path, "w", encoding="utf-8") as f:
            f.write(sa_json)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = cred_path

        project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
        if not project:
            return {"ok": False, "error": "Missing GOOGLE_CLOUD_PROJECT env var"}
        location = os.getenv("VERTEX_AI_LOCATION") or os.getenv("GOOGLE_CLOUD_LOCATION") or "us-central1"

        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"
        os.environ["GOOGLE_CLOUD_PROJECT"] = project
        os.environ["GOOGLE_CLOUD_LOCATION"] = location

        model_name = config.get("model", "gemini-2.5-flash")
        temperature = float(config.get("temperature", 0.1))
        max_tokens = int(config.get("max_tokens", 1000))
        schema_dict = config.get("schema") or {"type": "object", "properties": {}}
        user_instructions = config.get("instructions", "Return only valid JSON matching the schema.")
        final_instructions = (
            (DEFAULT_ENRICHMENT_SYSTEM_PROMPT + "\n" + user_instructions)
            if config.get("use_default_system_prompt", True)
            else user_instructions
        )

        client = genai.Client(http_options=HttpOptions(api_version="v1"))
        prompt = (
            "You are a precise information extractor.\n"
            "Follow the JSON schema exactly and return ONLY a valid JSON object.\n"
            f"Instructions: {final_instructions}\n\n"
            "Content to analyze (may contain HTML or free text):\n" + raw_text
        )

        resp = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema_dict,
                temperature=temperature,
                max_output_tokens=max_tokens,
            ),
        )
        text = resp.text
        if isinstance(text, str):
            try:
                data = json.loads(text)
                return {"ok": True, "data": data, "raw_text": text}
            except json.JSONDecodeError:
                return {"ok": False, "error": "Non-JSON response from GenAI SDK", "raw_text": text}
        return {"ok": False, "error": "GenAI SDK returned empty response"}
    except Exception:
        pass

    # Fallback: vertexai SDK without response_schema
    try:
        from google.oauth2 import service_account
        from vertexai import init as vertex_init
        from vertexai.generative_models import GenerativeModel, GenerationConfig

        creds_b64 = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_BASE64")
        if not creds_b64:
            return {"ok": False, "error": "Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64 env var"}
        creds_info = json.loads(base64.b64decode(creds_b64).decode("utf-8"))
        creds = service_account.Credentials.from_service_account_info(creds_info)

        project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
        location = os.getenv("VERTEX_AI_LOCATION") or "us-central1"
        if not project:
            return {"ok": False, "error": "Missing GOOGLE_CLOUD_PROJECT env var"}

        vertex_init(project=project, location=location, credentials=creds)

        model_name = config.get("model", "gemini-2.5-flash")
        temperature = float(config.get("temperature", 0.1))
        max_tokens = int(config.get("max_tokens", 10000))
        user_instructions = config.get("instructions", "Return only valid JSON matching the schema.")
        final_instructions = (
            (DEFAULT_ENRICHMENT_SYSTEM_PROMPT + "\n" + user_instructions)
            if config.get("use_default_system_prompt", True)
            else user_instructions
        )

        generation_config = GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
            response_mime_type="application/json",
        )

        prompt = (
            "You are a precise information extractor.\n"
            "Return ONLY a valid JSON object.\n"
            f"Instructions: {final_instructions}\n\n"
            "Content to analyze (may contain HTML or free text):\n" + raw_text
        )

        model = GenerativeModel(model_name)
        resp = model.generate_content([prompt], generation_config=generation_config)
        text = getattr(resp, "text", None)
        if not text:
            try:
                candidates = getattr(resp, "candidates", None)
                if candidates and candidates[0].content.parts:
                    text = "".join([p.text for p in candidates[0].content.parts if getattr(p, "text", None)])
            except Exception:
                text = None

        if isinstance(text, str):
            try:
                data = json.loads(text)
                return {"ok": True, "data": data, "raw_text": text}
            except json.JSONDecodeError:
                return {"ok": False, "error": "Non-JSON response from Vertex AI", "raw_text": text}

        return {"ok": False, "error": "Vertex AI returned empty response"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def enrich_results_if_enabled(
    results: Dict[str, Any],
    execution_params: Optional[Dict[str, Any]],
    automation_sequence: Optional[Dict[str, Any]],
    ai_enricher: Optional[Callable[[str, Dict[str, Any]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Apply enrichment to results in-place when policy enables it.

    ai_enricher: injectable function(raw_text, config) -> {ok: bool, data?: dict, error?: str}
    Returns the mutated results for convenience.
    """
    cfg = resolve_enrichment_policy(execution_params, automation_sequence)
    if not cfg:
        return results

    raw_payload = derive_raw_payload_from_results(results)
    if not raw_payload or not isinstance(raw_payload, str) or not raw_payload.strip():
        results["enrichment"] = {
            "status": "skipped",
            "reason": "no_raw_payload",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return results

    schema_hash = _hash_schema(cfg.get("schema"))
    mode = cfg.get("mode", "sync")

    if mode == "sync":
        enricher = ai_enricher or enrich_with_ai
        enrich_res = enricher(raw_payload, cfg)
        if enrich_res.get("ok"):
            results["raw_output"] = {"mime_type": detect_mime_type(raw_payload), "value": raw_payload}
            # Respect caller-configured storage key for structured output
            output_key = cfg.get("output_key", "structured_output")
            enriched_data = enrich_res.get("data")
            # Backward compatibility: ensure both snake_case and camelCase keys are present
            enriched_data = add_dual_case_keys_inplace(enriched_data)
            results[output_key] = enriched_data
            # Also provide a stable alias at structured_output for consumers/tests
            if output_key != "structured_output":
                results["structured_output"] = enriched_data
            results["enrichment"] = {
                "status": "succeeded",
                "mode": "sync",
                "model": cfg.get("model"),
                "schema_hash": schema_hash,
                "created_at": datetime.now(timezone.utc).isoformat(),
                # Notice for clients: future default will be snake_case-only
                "compatibility_notice": (
                    "Temporary: keys are provided in both snake_case and camelCase for backward compatibility. "
                    "Future responses will use snake_case only."
                ),
            }
        else:
            results["enrichment"] = {
                "status": "failed",
                "mode": "sync",
                "model": cfg.get("model"),
                "schema_hash": schema_hash,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "error_message": str(enrich_res.get("error") or "Unknown error"),
                "compatibility_notice": (
                    "Temporary: keys are provided in both snake_case and camelCase for backward compatibility. "
                    "Future responses will use snake_case only."
                ),
            }
        return results

    # async mode: mark pending, raw only
    results["raw_output"] = {"mime_type": detect_mime_type(raw_payload), "value": raw_payload}
    results["enrichment"] = {
        "status": "pending",
        "mode": "async",
        "model": cfg.get("model"),
        "schema_hash": schema_hash,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "compatibility_notice": (
            "Temporary: keys are provided in both snake_case and camelCase for backward compatibility. "
            "Future responses will use snake_case only."
        ),
    }
    return results


