"""
GitHub Workflow Loader for Modal
Fetches workflows directly from GitHub repo as primary source
"""
import logging
import os
from typing import Optional, Dict, Any
import base64

import requests
import yaml

logger = logging.getLogger(__name__)


class GitHubWorkflowLoader:
    """Load workflows from GitHub repository"""

    def __init__(self):
        self.token = os.environ.get("GITHUB_TOKEN")
        self.owner = "mediar-ai"
        self.repo = "workflows"
        self.base_url = f"https://api.github.com/repos/{self.owner}/{self.repo}"

        if not self.token:
            logger.warning("GITHUB_TOKEN not set - GitHub loading disabled")

    def load_workflow(self, github_folder: str, branch: str = "main") -> Optional[str]:
        """
        Load workflow YAML from GitHub

        Args:
            github_folder: Folder name (e.g., 'onedriveautomation')
            branch: Git branch to load from

        Returns:
            YAML content as string, or None if not found
        """
        if not self.token:
            logger.debug("GitHub token not available, skipping GitHub load")
            return None

        path = f"{github_folder}/workflow.yaml"
        url = f"{self.base_url}/contents/{path}"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }

        params = {"ref": branch}

        try:
            logger.info(f"📥 Loading workflow from GitHub: {path} (branch: {branch})")
            response = requests.get(url, headers=headers, params=params, timeout=10)

            if response.status_code == 404:
                logger.debug(f"Workflow not found in GitHub: {path}")
                return None

            response.raise_for_status()
            data = response.json()

            # Decode base64 content
            content = base64.b64decode(data["content"]).decode("utf-8")

            logger.info(f"✅ Loaded workflow from GitHub: {path}")
            return content

        except requests.exceptions.Timeout:
            logger.warning(f"GitHub API timeout for {path}")
            return None
        except requests.exceptions.RequestException as e:
            logger.warning(f"GitHub API error for {path}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error loading from GitHub: {e}")
            return None

    def parse_workflow_yaml(self, yaml_content: str) -> Dict[str, Any]:
        """
        Parse YAML content into workflow dict

        Args:
            yaml_content: Raw YAML string

        Returns:
            Parsed workflow dict

        Raises:
            yaml.YAMLError: If YAML is invalid
        """
        return yaml.safe_load(yaml_content)


# Singleton instance
_github_loader = None


def get_github_loader() -> GitHubWorkflowLoader:
    """Get or create GitHub loader instance"""
    global _github_loader
    if _github_loader is None:
        _github_loader = GitHubWorkflowLoader()
    return _github_loader
