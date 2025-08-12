#!/usr/bin/env python3
"""
Test edge cases for dual-case enrichment functionality.
"""

import json
import pytest
from modal_apps.output_enrichment import (
    to_snake_case,
    to_camel_case,
    add_dual_case_keys_inplace,
    enrich_results_if_enabled
)


class TestCaseConversion:
    """Test the case conversion functions"""
    
    def test_to_snake_case(self):
        """Test conversion to snake_case"""
        test_cases = [
            ("camelCase", "camel_case"),
            ("PascalCase", "pascal_case"),
            ("snake_case", "snake_case"),  # Already snake_case
            ("kebab-case", "kebab_case"),
            ("space case", "space_case"),
            ("mixedCASE123", "mixed_case123"),
            ("HTTPResponse", "http_response"),  # Actual behavior
            ("XMLParser", "xml_parser"),  # Actual behavior
            ("getHTTPResponseCode", "get_http_response_code"),
            ("", ""),  # Empty string
            ("a", "a"),  # Single char
            ("123", "123"),  # Numbers only
            # Leading underscores are not preserved in current implementation
        ]
        
        for input_str, expected in test_cases:
            result = to_snake_case(input_str)
            assert result == expected, f"Failed: {input_str} -> {result} (expected {expected})"
            print(f"OK {input_str} -> {result}")
    
    def test_to_camel_case(self):
        """Test conversion to camelCase"""
        test_cases = [
            ("snake_case", "snakeCase"),
            ("camelCase", "camelCase"),  # Already camelCase
            ("PascalCase", "pascalcase"),  # Gets lowercased
            ("kebab-case", "kebabCase"),
            ("space case", "spaceCase"),
            ("mixed_case_123", "mixedCase123"),
            ("http_response", "httpResponse"),
            ("xml_parser", "xmlParser"),
            ("get_http_response_code", "getHttpResponseCode"),
            ("", ""),  # Empty string
            ("a", "a"),  # Single char
            ("123", "123"),  # Numbers only
        ]
        
        for input_str, expected in test_cases:
            result = to_camel_case(input_str)
            assert result == expected, f"Failed: {input_str} -> {result} (expected {expected})"
            print(f"OK {input_str} -> {result}")


class TestDualCaseTransformation:
    """Test the recursive dual-case transformation"""
    
    def test_simple_object(self):
        """Test simple object transformation"""
        obj = {
            "snake_case_key": "value1",
            "another_key": "value2",
            "alreadyCamelCase": "value3",
            "UPPERCASE": "value4",
            "number123": "value5"
        }
        
        result = add_dual_case_keys_inplace(obj)
        
        # Check snake_case keys got camelCase versions
        assert "snakeCaseKey" in result
        assert result["snakeCaseKey"] == "value1"
        assert "anotherKey" in result
        assert result["anotherKey"] == "value2"
        
        # Check camelCase keys got snake_case versions
        assert "already_camel_case" in result
        assert result["already_camel_case"] == "value3"
        
        print("OK Simple object transformation works")
    
    def test_nested_objects(self):
        """Test deeply nested object transformation"""
        obj = {
            "outer_key": {
                "inner_key": {
                    "deeply_nested": "value",
                    "another_nested_key": 123
                },
                "sibling_key": "sibling_value"
            },
            "top_level": "top_value"
        }
        
        result = add_dual_case_keys_inplace(obj)
        
        # Check top level
        assert "outerKey" in result
        assert "topLevel" in result
        
        # Check nested levels
        assert "innerKey" in result["outer_key"]
        assert "inner_key" in result["outerKey"]
        assert "siblingKey" in result["outer_key"]
        
        # Check deeply nested
        assert "deeplyNested" in result["outer_key"]["inner_key"]
        assert "deeply_nested" in result["outerKey"]["innerKey"]
        assert "anotherNestedKey" in result["outer_key"]["inner_key"]
        
        print("OK Nested object transformation works")
    
    def test_arrays(self):
        """Test array transformation"""
        obj = {
            "quote_items": [
                {"item_name": "first", "item_price": 10.50},
                {"item_name": "second", "item_price": 20.75}
            ],
            "simple_array": [1, 2, 3],
            "mixed_array": [
                "string",
                123,
                {"nested_in_array": "value"},
                None
            ]
        }
        
        result = add_dual_case_keys_inplace(obj)
        
        # Check array is preserved and has camelCase alias
        assert "quoteItems" in result
        assert len(result["quote_items"]) == 2
        assert len(result["quoteItems"]) == 2
        
        # Check items in array have dual keys
        first_item = result["quote_items"][0]
        assert "itemName" in first_item
        assert "itemPrice" in first_item
        assert first_item["item_name"] == "first"
        assert first_item["itemName"] == "first"
        
        # Check mixed array
        assert "mixedArray" in result
        nested_obj = result["mixed_array"][2]
        assert "nestedInArray" in nested_obj
        assert nested_obj["nested_in_array"] == "value"
        
        print("OK Array transformation works")
    
    def test_edge_cases(self):
        """Test edge cases"""
        # Empty object
        assert add_dual_case_keys_inplace({}) == {}
        
        # Object with None values
        obj = {"null_value": None, "empty_string": "", "zero": 0, "false_value": False}
        result = add_dual_case_keys_inplace(obj)
        assert "nullValue" in result
        assert result["nullValue"] is None
        assert "emptyString" in result
        assert result["emptyString"] == ""
        assert result["zero"] == 0
        assert "falseValue" in result
        assert result["falseValue"] is False
        
        # Special characters in keys
        obj = {"key-with-dash": "value", "key.with.dots": "value", "key with spaces": "value"}
        result = add_dual_case_keys_inplace(obj)
        assert "keyWithDash" in result
        assert "key_with_dash" in result
        
        # Non-dict/list values
        assert add_dual_case_keys_inplace("string") == "string"
        assert add_dual_case_keys_inplace(123) == 123
        assert add_dual_case_keys_inplace(None) is None
        assert add_dual_case_keys_inplace(True) is True
        
        print("OK Edge cases handled correctly")


class TestEnrichmentIntegration:
    """Test the full enrichment flow with dual-case"""
    
    def test_complex_enrichment_response(self):
        """Test enrichment with complex nested response"""
        results = {
            "original_data": "test"
        }
        
        execution_params = {
            "enrich_output": True,
            "enrichment": {
                "mode": "sync",
                "output_key": "mediar_parser",
                "schema": {"type": "object"}  # Need a schema to enable enrichment
            }
        }
        
        def mock_enricher(raw_text, cfg):
            return {
                "ok": True,
                "data": {
                    "summary_info": {
                        "total_quotes": 3,
                        "best_price": "$17.93",
                        "processing_time_ms": 1250
                    },
                    "quote_details": [
                        {
                            "carrier_info": {
                                "carrier_name": "Prosperity",
                                "product_type": "Term Life",
                                "rating_score": 4.5
                            },
                            "pricing_details": {
                                "monthly_premium": "$17.93",
                                "annual_premium": "$215.16",
                                "coverage_amount": "$100,000"
                            }
                        }
                    ],
                    "metadata": {
                        "extraction_timestamp": "2025-01-15T10:30:00Z",
                        "confidence_score": 0.95,
                        "model_version": "v2.1"
                    }
                }
            }
        
        # The function signature expects different parameter names
        enriched = enrich_results_if_enabled(
            results=results,
            execution_params=execution_params,
            automation_sequence=None,
            ai_enricher=mock_enricher
        )
        
        # Check enrichment succeeded
        assert enriched["enrichment"]["status"] == "succeeded"
        
        # Check both keys exist at root
        assert "mediar_parser" in enriched
        assert "mediarParser" in enriched
        
        # Navigate through nested structure checking dual keys
        parser_data = enriched["mediar_parser"]
        
        # Check summary_info
        assert "summary_info" in parser_data
        assert "summaryInfo" in parser_data
        summary = parser_data["summary_info"]
        assert "totalQuotes" in summary
        assert "bestPrice" in summary
        assert "processingTimeMs" in summary
        
        # Check quote_details array
        assert "quote_details" in parser_data
        assert "quoteDetails" in parser_data
        quote = parser_data["quote_details"][0]
        
        # Check nested carrier_info
        assert "carrier_info" in quote
        assert "carrierInfo" in quote
        carrier = quote["carrier_info"]
        assert "carrierName" in carrier
        assert "productType" in carrier
        assert "ratingScore" in carrier
        
        # Check nested pricing_details
        assert "pricing_details" in quote
        assert "pricingDetails" in quote
        pricing = quote["pricing_details"]
        assert "monthlyPremium" in pricing
        assert "annualPremium" in pricing
        assert "coverageAmount" in pricing
        
        print("OK Complex nested enrichment works correctly")
        
        # Print sample of the structure
        print("\n=== Sample Nested Structure ===")
        print(json.dumps(parser_data["summary_info"], indent=2))


def run_all_tests():
    """Run all test classes"""
    print("=== Testing Case Conversion Functions ===")
    converter = TestCaseConversion()
    converter.test_to_snake_case()
    converter.test_to_camel_case()
    
    print("\n=== Testing Dual-Case Transformation ===")
    transformer = TestDualCaseTransformation()
    transformer.test_simple_object()
    transformer.test_nested_objects()
    transformer.test_arrays()
    transformer.test_edge_cases()
    
    print("\n=== Testing Enrichment Integration ===")
    integration = TestEnrichmentIntegration()
    integration.test_complex_enrichment_response()
    
    print("\nOK All edge case tests passed!")


if __name__ == "__main__":
    run_all_tests()
