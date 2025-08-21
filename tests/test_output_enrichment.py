import json
from typing import Any, Dict

import os
import re
import pytest
from modal_apps.output_enrichment import enrich_results_if_enabled


def _fake_enricher(raw_text: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    # Simulate successful structured extraction without calling external services
    return {
        "ok": True,
        "data": {
            "summary": "parsed successfully",
            "quote_items_detected": 2,
            "model_used": cfg.get("model"),
        },
        "raw_text": raw_text[:1000],
    }


def test_enrich_results_with_quotes_payload_sync_mode():
    # Sample input similar to MCP parsed_output entries
    sample_quotes = [
        {
            "extractedAt": "2025-08-11T21:00:37.707Z",
            "extractionStatus": "success",
            "fullText": "$17.93 - Prosperity PrimeTerm to 100: 20 YEAR TERM* ...",
            "quoteIndex": 1,
        },
        {
            "extractedAt": "2025-08-11T21:00:39.717Z",
            "extractionStatus": "success",
            "fullText": "$20.91 - TransAmerica FE Express Solution: GRADED ...",
            "quoteIndex": 2,
        },
    ]

    results = {
        # In worker we assign parsed_output to results["quotes"]
        "quotes": sample_quotes,
        # Keep other fields minimal for unit test
        "performance_metrics": {"successful_steps": 10},
    }

    execution_params = {
        "enrich_output": True,
        "enrichment": {
            "mode": "sync",
            "model": "gemini-2.5-flash",
            "schema": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "quote_items_detected": {"type": "number"},
                    "model_used": {"type": "string"},
                },
                "required": ["summary", "quote_items_detected"],
            },
            "instructions": "Summarize and count quote items.",
        },
    }

    # No workflow default schema needed because enrich_output=True
    automation_sequence = None

    enriched = enrich_results_if_enabled(
        results=results,
        execution_params=execution_params,
        automation_sequence=automation_sequence,
        ai_enricher=_fake_enricher,
    )

    # Assertions
    assert enriched["enrichment"]["status"] == "succeeded"
    # Support both legacy and new storage locations
    so = enriched.get("structured_output") or enriched.get("mediar_parser") or {}
    assert enriched["enrichment"]["mode"] == "sync"
    assert enriched["raw_output"]["mime_type"] in ("text/plain", "text/html")

    # The raw payload should contain the quote text content (we limit to text-only lines now)
    raw_val = enriched["raw_output"]["value"]
    assert isinstance(raw_val, str) and ("$17.93" in raw_val or "Prosperity" in raw_val)

    # Dual-case keys should be present inside structured_output
    so = so or {}
    assert so.get("quote_items_detected") == 2
    assert so.get("quoteItemsDetected") == 2
    assert so.get("model_used") == execution_params["enrichment"]["model"]
    assert so.get("modelUsed") == execution_params["enrichment"]["model"]


def test_structured_output_alias_and_dual_case_when_custom_output_key():
    # Arrange
    results = {"quotes": [{"fullText": "a", "quoteIndex": 1}]}
    exec_params = {
        "enrich_output": True,
        "enrichment": {
            "mode": "sync",
            "model": "gemini-2.5-flash",
            "schema": {
                "type": "object",
                "properties": {
                    "total_quotes": {"type": "number"},
                },
                "required": ["total_quotes"],
            },
            "output_key": "mediar_parser",
        },
    }

    def enricher(_raw: str, _cfg: Dict[str, Any]) -> Dict[str, Any]:
        return {"ok": True, "data": {"total_quotes": 1}}

    enriched = enrich_results_if_enabled(results, exec_params, None, ai_enricher=enricher)

    # The configured output_key should be set; structured_output is optional now
    assert "mediar_parser" in enriched

    # Dual-case keys should be present
    mp = enriched["mediar_parser"]
    assert mp.get("total_quotes") == 1
    assert mp.get("totalQuotes") == 1


@pytest.mark.integration
def test_enrich_results_with_real_vertex_if_env_present():
    # Skip if Vertex env vars are not present
    if not (
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS_BASE64")
        and os.getenv("GOOGLE_CLOUD_PROJECT")
    ):
        pytest.skip("Vertex env vars not set; skipping live integration test")

    results = {
        "quotes": [
            {"fullText": "$17.93 - Prosperity PrimeTerm to 100: 20 YEAR TERM* ...", "quoteIndex": 1},
            {"fullText": "$20.91 - TransAmerica FE Express Solution: GRADED ...", "quoteIndex": 2},
        ],
        "performance_metrics": {"successful_steps": 10},
    }

    execution_params = {
        "enrich_output": True,
        "enrichment": {
            "mode": "sync",
            "model": os.getenv("VERTEX_TEST_MODEL", "gemini-2.5-flash"),
            "schema": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "quote_items_detected": {"type": "number"},
                },
                "required": ["summary", "quote_items_detected"],
            },
            "instructions": "Summarize and count quote items.",
            "max_tokens": 10000,  # Lower token limit to avoid MAX_TOKENS error
        },
    }

    enriched = enrich_results_if_enabled(
        results=results,
        execution_params=execution_params,
        automation_sequence=None,
    )
    # Verbose logs to stdout so it's visible under -s
    print("\n=== ENRICHMENT METADATA ===\n" + json.dumps(enriched.get("enrichment"), ensure_ascii=False, indent=2))
    so = enriched.get("structured_output") or enriched.get("mediar_parser")
    if so is not None:
        print("\n=== STRUCTURED OUTPUT ===\n" + json.dumps(so, ensure_ascii=False, indent=2))
    
    # TEST DUAL-CASE KEYS (only when succeeded)
    so = enriched.get("structured_output") or enriched.get("mediar_parser")
    if so and enriched["enrichment"]["status"] == "succeeded":
        # Check that both snake_case and camelCase versions exist
        if "quote_items_detected" in so:
            assert "quoteItemsDetected" in so, "Missing camelCase version of quote_items_detected"
            assert so["quote_items_detected"] == so["quoteItemsDetected"], "Values don't match"
            print(f"OK Dual-case verified: quote_items_detected={so['quote_items_detected']}, quoteItemsDetected={so['quoteItemsDetected']}")
        
        if "summary" in so:
            # summary is already lowercase, no camelCase needed
            print(f"OK Summary field present: {so['summary'][:50]}...")
    else:
        print("\n=== NO STRUCTURED OUTPUT; FULL ENRICHED ===\n" + json.dumps(enriched, ensure_ascii=False, indent=2))

    assert "enrichment" in enriched
    assert enriched["enrichment"]["status"] in ("succeeded", "failed")
    if enriched["enrichment"]["status"] == "succeeded":
        assert any(k in enriched for k in ("structured_output", "mediar_parser"))


def _quote_array_schema():
    return {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "carrierProduct": {"type": "STRING"},
                "quoteValue": {"type": "STRING"},
                "quoteType": {"type": "STRING"},
                "status": {
                    "type": "STRING",
                    "enum": [
                        "Available",
                        "Discontinued",
                        "Ineligible",
                        "Excluded",
                        "Unknown",
                    ],
                },
            },
            "required": [
                "carrierProduct",
                "quoteValue",
                "quoteType",
                "status",
            ],
        },
    }


def _quote_instructions():
    return (
        "Extract all quote cards into an array. For each: "
        "carrierProduct: full carrier + product text as shown. "
        "quoteValue: include currency symbol, e.g. '$17.93'. "
        "quoteType: normalize to 'Monthly Price' when a monthly price is shown (map MONTHLY/MONTHLY-EFT/etc.). "
        "status: 'Discontinued' if card indicates discontinued; 'Ineligible' or 'Excluded' if marked so; else 'Available'. "
        "Return ONLY valid JSON matching the schema."
    )


@pytest.mark.integration
def test_structured_output_quality_with_messy_inputs():
    if not (
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS_BASE64")
        and os.getenv("GOOGLE_CLOUD_PROJECT")
    ):
        pytest.skip("Vertex env vars not set; skipping live quality test")

    messy_scenarios = [
        # Minimal snippets, varied labels and statuses
        [
            {"fullText": "$17.93 - Prosperity PrimeTerm to 100: 20 YEAR TERM* ... Discontinued"},
            {"fullText": "$20.91 - TransAmerica FE Express Solution: GRADED ..."},
            {"fullText": "$29.92 - GTL Heritage Plan: GRADED ... MONTHLY-EFT"},
        ],
        [
            {"fullText": "Prosperity ... Monthly Price $17.93"},
            {"fullText": "TransAmerica ... monthly $20.91"},
            {"fullText": "GTL Heritage ... QUARTERLY $89.75 (monthly $29.92)"},
        ],
        [
            {"fullText": "$26.25 - Wellabe Final Expense: GUARANTEED ASSURANCE* ... Discontinued"},
            {"fullText": "Aetna Accendo: MODIFIED MONTHLY $19.38"},
            {"fullText": "Liberty Bankers Simpl: MODIFIED  Monthly  $22.49 Available"},
        ],
        [
            {"fullText": "$26.76 - Columbian Life Dignified Choice: ADVANTAGE*  MONTHLY-ADB $27.73"},
            {"fullText": "Senior Life Whole Life: MODIFIED MONTHLY $39.21"},
        ],
        [
            {"fullText": "EXCLUDED Reason: Age  Aetna Individual Whole Life  N/A"},
            {"fullText": "EXCLUDE  American Amicable Clear Choice  N/A"},
            {"fullText": "$21.60 - Assurant Whole Life: MODIFIED*"},
        ],
    ]

    schema = _quote_array_schema()
    instructions = _quote_instructions()

    def run_case(quotes_list):
        results = {"quotes": quotes_list}
        exec_params = {
            "enrich_output": True,
            "enrichment": {
                "mode": "sync",
                "model": os.getenv("VERTEX_TEST_MODEL", "gemini-2.5-flash"),
                "schema": schema,
                "instructions": instructions,
                "temperature": 0.1,
                "max_tokens": 20000,
            },
        }
        return enrich_results_if_enabled(results, exec_params, None)

    total_items = 0
    passed_items = 0
    currency_ok = 0
    type_ok = 0
    status_ok = 0

    for idx, scenario in enumerate(messy_scenarios, start=1):
        enriched = run_case(scenario)
        so = enriched.get("structured_output") or enriched.get("mediar_parser") or []
        print(f"\n=== Scenario {idx} | items: {len(so)} ===")
        print(json.dumps(so, ensure_ascii=False, indent=2))
        for item in so:
            total_items += 1
            fields_present = all(
                isinstance(item.get(k), str) and item.get(k).strip() for k in [
                    "carrierProduct",
                    "quoteValue",
                    "quoteType",
                    "status",
                ]
            )
            passed_items += 1 if fields_present else 0
            qv = item.get("quoteValue", "")
            if not isinstance(qv, str):
                qv = ""
            if re.search(r"\$\s*\d", qv):
                currency_ok += 1
            qt = item.get("quoteType", "")
            if not isinstance(qt, str):
                qt = ""
            if qt == "Monthly Price":
                type_ok += 1
            st = item.get("status", "")
            if not isinstance(st, str):
                st = ""
            if st in {"Available", "Discontinued", "Ineligible", "Excluded", "Unknown"}:
                status_ok += 1

    # Metrics and thresholds
    print("\n=== Quality Metrics ===")
    print(f"total_items={total_items}")
    print(f"fields_present_rate={passed_items / max(total_items,1):.2f}")
    print(f"currency_symbol_rate={currency_ok / max(total_items,1):.2f}")
    print(f"quoteType_monthly_normalization_rate={type_ok / max(total_items,1):.2f}")
    print(f"status_enum_rate={status_ok / max(total_items,1):.2f}")

    # Soft assertions: ensure minimum reasonable quality
    assert total_items >= 3, "Model returned too few items across scenarios"
    # Use soft lower bounds to avoid flakiness in early iterations
    assert passed_items / total_items >= 0.4, "Too many items missing required fields"
    assert currency_ok / total_items >= 0.3, "Currency symbol often missing"
    assert status_ok / total_items >= 0.6, "Status not mapped to enum reliably"


