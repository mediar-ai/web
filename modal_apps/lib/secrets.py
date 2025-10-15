"""
Secrets management utilities for workflow execution
Handles decryption and injection of org-level secrets
"""
import base64
import hashlib
import logging
import os
from typing import Dict, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

# Constants
ALGORITHM = "AES-GCM"
IV_LENGTH = 12  # 96 bits recommended for GCM


def get_master_key() -> bytes:
    """Get the master encryption key from environment"""
    key_str = os.environ.get("SECRETS_ENCRYPTION_KEY")
    if not key_str:
        raise ValueError("SECRETS_ENCRYPTION_KEY environment variable is not set")

    # Hash the key to get consistent 256-bit key
    key_hash = hashlib.sha256(key_str.encode()).digest()
    return key_hash


def decrypt_secret(encrypted_value: str) -> str:
    """
    Decrypt a secret value

    Args:
        encrypted_value: Base64-encoded encrypted value with IV prepended

    Returns:
        Decrypted plaintext secret
    """
    try:
        master_key = get_master_key()

        # Decode from base64
        combined = base64.b64decode(encrypted_value)

        # Extract IV and ciphertext
        iv = combined[:IV_LENGTH]
        ciphertext = combined[IV_LENGTH:]

        # Initialize AESGCM cipher
        aesgcm = AESGCM(master_key)

        # Decrypt
        plaintext = aesgcm.decrypt(iv, ciphertext, None)

        return plaintext.decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to decrypt secret: {e}")
        raise ValueError(f"Failed to decrypt secret: {e}")


def load_org_secrets(conn, org_id: str) -> Dict[str, str]:
    """
    Load and decrypt all secrets for an organization

    Args:
        conn: Database connection
        org_id: Organization ID

    Returns:
        Dictionary of secret_name -> decrypted_value
    """
    secrets = {}

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT name, encrypted_value
                FROM org_secrets
                WHERE org_id = %s
                """,
                (org_id,)
            )

            rows = cur.fetchall()

            for row in rows:
                name, encrypted_value = row
                try:
                    decrypted_value = decrypt_secret(encrypted_value)
                    secrets[name] = decrypted_value
                    logger.info(f"Loaded secret: {name}")
                except Exception as e:
                    logger.error(f"Failed to decrypt secret {name}: {e}")
                    # Continue loading other secrets even if one fails

    except Exception as e:
        logger.error(f"Failed to load org secrets: {e}")
        # Return empty dict if loading fails - don't block workflow execution

    return secrets


def inject_secrets_into_params(
    params: Dict,
    secrets: Dict[str, str],
    substitute_placeholders: bool = True
) -> Dict:
    """
    Inject secrets into workflow parameters

    Supports two modes:
    1. Placeholder substitution: Replace ${SECRET_NAME} with actual values
    2. Direct injection: Add secrets as top-level parameters

    Args:
        params: Workflow execution parameters
        secrets: Dictionary of secret_name -> value
        substitute_placeholders: If True, replace ${SECRET_NAME} in string values

    Returns:
        Updated parameters with secrets injected
    """
    result = params.copy()

    # Mode 1: Substitute placeholders in existing parameters
    if substitute_placeholders:
        result = _substitute_placeholders(result, secrets)

    # Mode 2: Add secrets as top-level parameters
    # This allows workflows to access secrets directly as variables
    # Support both UPPERCASE and lowercase_with_underscores naming conventions
    for name, value in secrets.items():
        # Add secret with original name
        if name not in result:
            result[name] = value

        # Also add lowercase version for compatibility
        # E.g., APOLLO_API_KEY -> apollo_api_key
        lowercase_name = name.lower()
        if lowercase_name not in result:
            result[lowercase_name] = value

    return result


def _substitute_placeholders(obj, secrets: Dict[str, str]):
    """
    Recursively substitute ${SECRET_NAME} placeholders in strings
    """
    if isinstance(obj, str):
        # Replace ${SECRET_NAME} with actual value
        for name, value in secrets.items():
            placeholder = f"${{{name}}}"
            if placeholder in obj:
                obj = obj.replace(placeholder, value)
        return obj
    elif isinstance(obj, dict):
        return {k: _substitute_placeholders(v, secrets) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_substitute_placeholders(item, secrets) for item in obj]
    else:
        return obj
