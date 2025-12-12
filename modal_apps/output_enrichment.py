from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
import logging
from typing import Any, Callable, Dict, Optional
logger = logging.getLogger(__name__)

def _safe_sample(value: Any, limit: int = 400) -> str:
    try:
        s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    except Exception:
        s = str(value)
    if s is None:
        return ""
    return s[:limit] + ("…" if len(s) > limit else "")

def resolve_enrichment_policy(
    execution_params: Optional[Dict[str, Any]],
    automation_sequence: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Decide whether to run enrichment and with what configuration.

    Precedence:
    1) explicit runtime overrides
       - execution_params.mediar_parser.schema
       - execution_params.enrich_output / execution_params.enrichment
    2) workflow default from sequence.arguments.mediar_parser.schema
    3) otherwise disabled
    """
    params = execution_params or {}
    enrichment_block = params.get("enrichment") if isinstance(params, dict) else None
    enrich_flag = params.get("enrich_output") if isinstance(params, dict) else None
    # Runtime schema override under mediar_parser.schema (preferred)
    runtime_schema_override = None
    if isinstance(params, dict):
        mp = params.get("mediar_parser")
        if isinstance(mp, dict):
            runtime_schema_override = mp.get("schema")

    # Check workflow defaults (STRICT): only arguments.mediar_parser.schema is supported
    default_schema = None
    if automation_sequence and isinstance(automation_sequence, dict):
        args = automation_sequence.get("arguments", {})
        if isinstance(args, dict):
            mediar_parser_cfg = args.get("mediar_parser")
            if isinstance(mediar_parser_cfg, dict):
                default_schema = mediar_parser_cfg.get("schema")

    # Decide enablement
    enabled = bool(enrich_flag) or (default_schema is not None) or (runtime_schema_override is not None)
    logger.info(
        "enrichment_policy: enabled=%s, enrich_flag=%s, runtime_schema=%s, default_schema=%s, enrichment_keys=%s",
        bool(enabled), bool(enrich_flag),
        "present" if runtime_schema_override is not None else "absent",
        "present" if default_schema is not None else "absent",
        list((enrichment_block or {}).keys()) if isinstance(enrichment_block, dict) else None,
    )
    if not enabled:
        return None

    # Build config
    config: Dict[str, Any] = {
        "mode": (enrichment_block or {}).get("mode", "sync"),
        "model": (enrichment_block or {}).get("model", "gemini-2.5-flash"),
        # Prefer explicit runtime override, then enrichment.schema, then workflow default
        "schema": (enrichment_block or {}).get("schema", runtime_schema_override or default_schema),
        "instructions": (enrichment_block or {}).get(
            "instructions",
            "Extract structured data from the provided content according to the schema. Return ONLY valid JSON matching the schema.",
        ),
        "temperature": (enrichment_block or {}).get("temperature", 0.1),
        "max_tokens": (enrichment_block or {}).get("max_tokens", 10000),
        "use_default_system_prompt": (enrichment_block or {}).get("use_default_system_prompt", True),
        # Placement and input shaping controls (optional)
        "output_key": (enrichment_block or {}).get("output_key", "quotes"),  # e.g., "structured_output", "mediar_parser", "quotes"
        "replace_quotes": bool((enrichment_block or {}).get("replace_quotes", False)),
        "omit_mediar_parser_alias": bool((enrichment_block or {}).get("omit_mediar_parser_alias", False)),
        # Feed-size control for derive_raw_payload_from_results
        "input_max_items": (enrichment_block or {}).get("input_max_items"),
        # Configure where to read text items from and which fields to read
        # Defaults keep backward compatibility with existing workflows
        "input_source_keys": (enrichment_block or {}).get("input_source_keys"),  # list[str]
        "input_text_fields": (enrichment_block or {}).get("input_text_fields"),  # list[str]
        "input_join_delimiter": (enrichment_block or {}).get("input_join_delimiter"),  # string
    }

    # If no schema is available at all, disable
    if not config.get("schema"):
        return None
    try:
        schema_hash = _hash_schema(config.get("schema"))
    except Exception:
        schema_hash = "unknown"
    logger.info(
        "enrichment_policy: config -> mode=%s model=%s schema_hash=%s max_tokens=%s temp=%s instructions_len=%s",
        config.get("mode"), config.get("model"), schema_hash,
        config.get("max_tokens"), config.get("temperature"),
        len(config.get("instructions", "")) if isinstance(config.get("instructions"), str) else None,
    )
    return config


DEFAULT_ENRICHMENT_SYSTEM_PROMPT = """
You are a deterministic information extraction agent.
Task: Extract only the fields defined by the provided JSON schema.
Requirements:
- Output MUST be valid JSON that strictly matches the schema.
- Do NOT include any commentary or extra keys.
- Prefer monthly price values; ignore quarterly/semi-annual/annual unless instructed otherwise.
- Normalize monthly-like labels (e.g., MONTHLY, monthly, MONTHLY-EFT) under the same monthly concept.
- Map statuses consistently (e.g., Discontinued, Ineligible/Excluded, Available, Unknown).
- If a field cannot be confidently extracted without violating the schema, SKIP that item.
- If there is no quote, return an empty array.
"""


def detect_mime_type(text: Any) -> str:
    if not isinstance(text, str):
        return "text/plain"
    lower = text.strip().lower()
    if "<html" in lower or "</html>" in lower:
        return "text/html"
    return "text/plain"


def to_snake_case(key: str) -> str:
    """Convert a string from camelCase/PascalCase/kebab-case/space case to snake_case.

    Handles acronym groups sensibly (e.g., HTTPResponse -> http_response) and
    avoids over-separating consecutive capitals (e.g., XMLParser -> xml_parser).
    """
    if not isinstance(key, str) or not key:
        return key

    s = key.strip()
    if not s:
        return s

    # Normalize separators to underscores first
    s = re.sub(r"[-\s]+", "_", s)

    # Insert underscore between a lower/digit and upper (fooBar -> foo_Bar)
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", s)

    # Insert underscore between acronym and word boundary (HTTPResponse -> HTTP_Response)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", s)

    # Collapse repeats and lowercase
    s = re.sub(r"__+", "_", s).lower()
    return s


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


def derive_raw_payload_from_results(results: Dict[str, Any], cfg: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Try to extract a concise textual payload suitable for LLM parsing.

    Preference order (optimized to avoid huge token usage):
    1) Quotes: join only the specific text content for each quote (e.g., fullText/text), capped by input_max_items
    2) String-like extracted_data
    3) Direct text from step_details content items (first available)
    4) raw_mcp_response content text (first available)
    5) Fallback to serialized results
    """
    try:
        # TODO: why this dumb input?
        max_items = 1000
        if isinstance(cfg, dict):
            try:
                max_items = int(cfg.get("input_max_items", max_items))
            except Exception:
                max_items = 1000

        source_used = None
        # 1) Primary: configurable list source(s), defaulting to 'quotes'
        source_keys = cfg.get("input_source_keys") if isinstance(cfg, dict) else None
        if not isinstance(source_keys, list) or not source_keys:
            source_keys = ["quotes"]

        text_fields = cfg.get("input_text_fields") if isinstance(cfg, dict) else None
        if not isinstance(text_fields, list) or not text_fields:
            text_fields = ["fullText", "text"]

        join_delim = cfg.get("input_join_delimiter") if isinstance(cfg, dict) else None
        if not isinstance(join_delim, str) or not join_delim:
            join_delim = "\n"

        collected: list[str] = []
        total_candidates = 0
        for key in source_keys:
            container = results.get(key)
            if isinstance(container, list) and container:
                total_candidates += len(container)
                for item in container[:max_items - len(collected)]:
                    if isinstance(item, dict):
                        text_val = None
                        for f in text_fields:
                            v = item.get(f)
                            if isinstance(v, str) and v.strip():
                                text_val = v
                                break
                        if text_val:
                            collected.append(text_val)
                    elif isinstance(item, str) and item.strip():
                        collected.append(item)
                    if len(collected) >= max_items:
                        break
            if len(collected) >= max_items:
                break

        if collected:
            payload = join_delim.join(collected)
            source_used = f"{','.join(source_keys)}(count={len(collected)}/{total_candidates})"
            logger.info(
                "derive_raw_payload: source=%s length=%d sample=%r",
                source_used, len(payload), _safe_sample(payload, 300),
            )
            return payload

        # 2) extracted_data (string)
        extracted = results.get("extracted_data")
        if isinstance(extracted, str) and extracted.strip():
            logger.info(
                "derive_raw_payload: source=extracted_data length=%d sample=%r",
                len(extracted), _safe_sample(extracted, 300),
            )
            return extracted

        # 3) step_details content text (first available)
        step_details = results.get("step_details")
        if isinstance(step_details, list):
            for group in step_details:
                if isinstance(group, dict) and isinstance(group.get("results"), list):
                    for step in group["results"]:
                        content = step.get("result", {}).get("content") if isinstance(step, dict) else None
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                                    text_val = item["text"]
                                    logger.info(
                                        "derive_raw_payload: source=step_details length=%d sample=%r",
                                        len(text_val), _safe_sample(text_val, 300),
                                    )
                                    return text_val

        # 4) raw_mcp_response content text
        raw_mcp = results.get("raw_mcp_response")
        if isinstance(raw_mcp, dict):
            try:
                content_list = raw_mcp.get("result", {}).get("content", [])
                if isinstance(content_list, list) and content_list:
                    first_text = next((c.get("text") for c in content_list if isinstance(c, dict) and isinstance(c.get("text"), str)), None)
                    if first_text:
                        logger.info(
                            "derive_raw_payload: source=raw_mcp_response length=%d sample=%r",
                            len(first_text), _safe_sample(first_text, 300),
                        )
                        return first_text
            except Exception:
                pass

        # 5) fallback to serialized results
        fallback = json.dumps(results, ensure_ascii=False)
        logger.info(
            "derive_raw_payload: source=fallback_serialized length=%d sample=%r",
            len(fallback), _safe_sample(fallback, 300),
        )
        return fallback
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
        max_tokens = int(config.get("max_tokens", 10000))
        def _normalize_schema(schema: Any) -> Any:
            # Accept Vertex-style uppercase shorthand and convert to JSON Schema
            if isinstance(schema, dict):
                t = schema.get("type")
                if isinstance(t, str):
                    mapped = {
                        "ARRAY": "array",
                        "OBJECT": "object",
                        "STRING": "string",
                        "NUMBER": "number",
                        "INTEGER": "integer",
                        "BOOLEAN": "boolean",
                    }.get(t, t.lower())
                    schema = {**schema, "type": mapped}
                # Recurse
                out: Dict[str, Any] = {}
                for k, v in schema.items():
                    if k in ("items", "properties"):
                        if k == "items":
                            out[k] = _normalize_schema(v)
                        else:
                            out[k] = {pk: _normalize_schema(pv) for pk, pv in (v or {}).items()}
                    else:
                        out[k] = _normalize_schema(v) if isinstance(v, (dict, list)) else v
                return out
            if isinstance(schema, list):
                return [_normalize_schema(x) for x in schema]
            return schema

        schema_dict = _normalize_schema(config.get("schema") or {"type": "object", "properties": {}})
        schema_hash = _hash_schema(schema_dict)
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

        logger.info(
            "enrich_with_ai[genai]: model=%s temp=%s max_tokens=%s schema_hash=%s raw_len=%d",
            model_name, temperature, max_tokens, schema_hash, len(raw_text),
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
                logger.info(
                    "enrich_with_ai[genai]: ok=True response_len=%d sample=%r",
                    len(text), _safe_sample(text, 300),
                )
                return {"ok": True, "data": data, "raw_text": text}
            except json.JSONDecodeError:
                logger.warning(
                    "enrich_with_ai[genai]: ok=False non_json response_len=%d sample=%r",
                    len(text), _safe_sample(text, 300),
                )
                return {"ok": False, "error": "Non-JSON response from GenAI SDK", "raw_text": text}
        logger.warning("enrich_with_ai[genai]: empty response")
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

        logger.info(
            "enrich_with_ai[vertexai]: model=%s temp=%s max_tokens=%s raw_len=%d",
            model_name, temperature, max_tokens, len(raw_text),
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
                logger.info(
                    "enrich_with_ai[vertexai]: ok=True response_len=%d sample=%r",
                    len(text), _safe_sample(text, 300),
                )
                return {"ok": True, "data": data, "raw_text": text}
            except json.JSONDecodeError:
                logger.warning(
                    "enrich_with_ai[vertexai]: ok=False non_json response_len=%d sample=%r",
                    len(text), _safe_sample(text, 300),
                )
                return {"ok": False, "error": "Non-JSON response from Vertex AI", "raw_text": text}

        logger.warning("enrich_with_ai[vertexai]: empty response")
        return {"ok": False, "error": "Vertex AI returned empty response"}
    except Exception as e:
        logger.error("enrich_with_ai[vertexai]: exception=%s", str(e))
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
        logger.info("enrich_results_if_enabled: disabled (no config)")
        return results

    raw_payload = derive_raw_payload_from_results(results, cfg)
    if not raw_payload or not isinstance(raw_payload, str) or not raw_payload.strip():
        logger.info("enrich_results_if_enabled: skipped (no_raw_payload)")
        results["enrichment"] = {
            "status": "skipped",
            "reason": "no_raw_payload",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return results

    schema_hash = _hash_schema(cfg.get("schema"))
    mode = cfg.get("mode", "sync")
    logger.info(
        "enrich_results_if_enabled: start mode=%s model=%s schema_hash=%s raw_len=%d",
        mode, cfg.get("model"), schema_hash, len(raw_payload),
    )

    if mode == "sync":
        enricher = ai_enricher or enrich_with_ai
        start = datetime.now(timezone.utc)
        enrich_res = enricher(raw_payload, cfg)
        duration_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        logger.info(
            "enrich_results_if_enabled: sync finished ok=%s duration_ms=%d",
            bool(enrich_res.get("ok")), duration_ms,
        )
        if enrich_res.get("ok"):
            results["raw_output"] = {"mime_type": detect_mime_type(raw_payload), "value": raw_payload}
            enriched_data = enrich_res.get("data")
            # Backward compatibility: ensure both snake_case and camelCase keys are present
            enriched_data = add_dual_case_keys_inplace(enriched_data)

            # Decide placement
            output_key = cfg.get("output_key")
            replace_quotes = bool(cfg.get("replace_quotes"))
            omit_alias = bool(cfg.get("omit_mediar_parser_alias"))

            # If we're outputting to 'quotes', attach raw_text for each item when possible
            try:
                if (
                    output_key == "quotes"
                    and isinstance(enriched_data, list)
                    and isinstance(results.get("quotes"), list)
                ):
                    original_list = results.get("quotes") or []
                    text_fields = cfg.get("input_text_fields") if isinstance(cfg, dict) else None
                    if not isinstance(text_fields, list) or not text_fields:
                        text_fields = ["fullText", "text"]
                    lim = min(len(enriched_data), len(original_list))
                    for i in range(lim):
                        item = enriched_data[i]
                        if isinstance(item, dict):
                            # Skip if raw_text already provided by the model
                            if not ("raw_text" in item or "rawText" in item):
                                src = original_list[i]
                                raw_val = None
                                if isinstance(src, dict):
                                    for f in text_fields:
                                        v = src.get(f)
                                        if isinstance(v, str) and v.strip():
                                            raw_val = v
                                            break
                                elif isinstance(src, str) and src.strip():
                                    raw_val = src
                                if raw_val is not None:
                                    item["raw_text"] = raw_val
                                    item["rawText"] = raw_val
            except Exception:
                # Non-fatal: raw_text is a best-effort convenience
                pass

            placed = False
            if output_key:
                if output_key == "quotes" and replace_quotes:
                    # Replace original quotes with enriched array/object
                    results["quotes"] = enriched_data
                    placed = True
                else:
                    # Place enriched data under the requested key
                    results[output_key] = enriched_data
                    placed = True

            if not placed:
                # Default behavior: if object, spread at root; otherwise keep also under structured_output
                if isinstance(enriched_data, dict):
                    results.update(enriched_data)
                else:
                    results["structured_output"] = enriched_data

            # Keep legacy aliases for UI unless explicitly omitted
            if not omit_alias:
                results["mediar_parser"] = enriched_data
                results["mediarParser"] = enriched_data
            
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
            # Deterministic fallback: derive minimal structure from quotes text
            def _fallback_structured_from_quotes(res: Dict[str, Any]) -> list:
                out = []
                quotes = res.get("quotes")
                if not isinstance(quotes, list):
                    return out
                for q in quotes:
                    if not isinstance(q, dict):
                        continue
                    text = q.get("fullText") or q.get("text") or ""
                    if not isinstance(text, str):
                        text = str(text)
                    # carrierProduct: up to first newline; fallback to first 140 chars
                    carrier_product = None
                    try:
                        first_line = text.split("\n", 1)[0]
                        carrier_product = first_line.strip()
                    except Exception:
                        carrier_product = text[:140].strip()
                    # quoteValue: first $amount pattern
                    quote_value = None
                    m = re.search(r"\$\s*\d[\d,]*\.?\d*", text)
                    if m:
                        quote_value = m.group(0).replace(" ", "")
                    # quoteType: Monthly Price if monthly-ish present
                    qt = "Monthly Price" if re.search(r"monthly|monthly-?eft|month", text, re.I) else "Unknown"
                    # status inference
                    st = (
                        "Discontinued" if re.search(r"discontinued", text, re.I)
                        else ("Ineligible" if re.search(r"ineligible", text, re.I) else ("Excluded" if re.search(r"excluded|exclude", text, re.I) else "Available"))
                    )
                    item = {
                        "carrierProduct": carrier_product or "Unknown",
                        "quoteValue": quote_value or "",
                        "quoteType": qt,
                        "status": st,
                        "raw_text": text,
                    }
                    out.append(item)
                return out

            fallback_items = []
            try:
                fallback_items = _fallback_structured_from_quotes(results)
            except Exception as _e:
                logger.warning("fallback_structured_from_quotes: error=%s", str(_e))

            # If we have a useful fallback, attach it and also decorate original quotes with key fields
            if isinstance(fallback_items, list) and fallback_items:
                try:
                    # Add dual-case aliases for compatibility
                    fallback_items = add_dual_case_keys_inplace(fallback_items)
                    # Place under requested key (default: quotes) without replacing by default
                    output_key = cfg.get("output_key") or "quotes"
                    replace_quotes = bool(cfg.get("replace_quotes"))
                    if output_key == "quotes" and replace_quotes:
                        results["quotes"] = fallback_items
                    else:
                        results[output_key] = fallback_items
                    # Also mirror under mediar_parser unless omitted
                    if not bool(cfg.get("omit_mediar_parser_alias")):
                        results["mediar_parser"] = fallback_items
                        results["mediarParser"] = fallback_items
                    # Decorate original quotes in place so UI can read quoteValue
                    if isinstance(results.get("quotes"), list):
                        lim = min(len(results["quotes"]), len(fallback_items))
                        for i in range(lim):
                            if isinstance(results["quotes"][i], dict) and isinstance(fallback_items[i], dict):
                                for k, v in fallback_items[i].items():
                                    # Do not clobber existing non-empty values
                                    if k not in results["quotes"][i] or not results["quotes"][i].get(k):
                                        results["quotes"][i][k] = v
                except Exception as _e:
                    logger.warning("fallback placement failed: %s", str(_e))

            results["enrichment"] = {
                "status": "failed" + ("_fallback_applied" if fallback_items else ""),
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
    logger.info("enrich_results_if_enabled: async pending; raw_len=%d", len(raw_payload))
    return results


