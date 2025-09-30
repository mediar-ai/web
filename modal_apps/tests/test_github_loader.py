"""
Unit tests for GitHub workflow loader
"""
import os
import pytest
from unittest.mock import Mock, patch, MagicMock
import base64

from modal_apps.lib.github_loader import GitHubWorkflowLoader


@pytest.fixture
def mock_workflow_yaml():
    return """---
tool_name: execute_sequence
arguments:
  steps:
    - tool_name: navigate_browser
      arguments:
        url: "https://example.com"
"""


@pytest.fixture
def github_loader():
    """Create loader with mocked token"""
    with patch.dict(os.environ, {'GITHUB_TOKEN': 'test_token'}):
        return GitHubWorkflowLoader()


class TestGitHubWorkflowLoader:
    """Test GitHub workflow loading functionality"""

    def test_init_with_token(self):
        """Test initialization with GitHub token"""
        with patch.dict(os.environ, {'GITHUB_TOKEN': 'test_token'}):
            loader = GitHubWorkflowLoader()
            assert loader.token == 'test_token'
            assert loader.owner == 'mediar-ai'
            assert loader.repo == 'workflows'

    def test_init_without_token(self):
        """Test initialization without GitHub token"""
        with patch.dict(os.environ, {}, clear=True):
            loader = GitHubWorkflowLoader()
            assert loader.token is None

    @patch('modal_apps.lib.github_loader.requests.get')
    def test_load_workflow_success(self, mock_get, github_loader, mock_workflow_yaml):
        """Test successful workflow loading from GitHub"""
        # Mock successful API response
        encoded_content = base64.b64encode(mock_workflow_yaml.encode()).decode()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'content': encoded_content,
            'sha': 'abc123'
        }
        mock_get.return_value = mock_response

        result = github_loader.load_workflow('testworkflow')

        assert result == mock_workflow_yaml
        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        assert 'testworkflow/workflow.yaml' in args[0]
        assert kwargs['headers']['Authorization'] == 'Bearer test_token'

    @patch('modal_apps.lib.github_loader.requests.get')
    def test_load_workflow_not_found(self, mock_get, github_loader):
        """Test workflow not found (404)"""
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.raise_for_status.side_effect = Exception("404")
        mock_get.return_value = mock_response

        # Should catch exception and return None
        with patch.object(mock_response, 'raise_for_status'):
            mock_get.return_value.status_code = 404
            result = github_loader.load_workflow('nonexistent')
            assert result is None

    @patch('modal_apps.lib.github_loader.requests.get')
    def test_load_workflow_timeout(self, mock_get, github_loader):
        """Test GitHub API timeout"""
        import requests
        mock_get.side_effect = requests.exceptions.Timeout()

        result = github_loader.load_workflow('testworkflow')

        assert result is None

    @patch('modal_apps.lib.github_loader.requests.get')
    def test_load_workflow_with_branch(self, mock_get, github_loader, mock_workflow_yaml):
        """Test loading from specific branch"""
        encoded_content = base64.b64encode(mock_workflow_yaml.encode()).decode()
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'content': encoded_content}
        mock_get.return_value = mock_response

        result = github_loader.load_workflow('testworkflow', branch='dev')

        assert result == mock_workflow_yaml
        _, kwargs = mock_get.call_args
        assert kwargs['params']['ref'] == 'dev'

    def test_load_workflow_no_token(self):
        """Test loading without token configured"""
        with patch.dict(os.environ, {}, clear=True):
            loader = GitHubWorkflowLoader()
            result = loader.load_workflow('testworkflow')
            assert result is None

    def test_parse_workflow_yaml(self, github_loader, mock_workflow_yaml):
        """Test YAML parsing"""
        result = github_loader.parse_workflow_yaml(mock_workflow_yaml)

        assert isinstance(result, dict)
        assert result['tool_name'] == 'execute_sequence'
        assert 'arguments' in result
        assert 'steps' in result['arguments']

    def test_parse_invalid_yaml(self, github_loader):
        """Test parsing invalid YAML"""
        import yaml
        invalid_yaml = "{ invalid yaml content: ["

        with pytest.raises(yaml.YAMLError):
            github_loader.parse_workflow_yaml(invalid_yaml)


class TestSequenceLoaderIntegration:
    """Test SequenceLoader with GitHub integration"""

    @patch('modal_apps.lib.github_loader.GitHubWorkflowLoader.load_workflow')
    def test_github_first_priority(self, mock_load):
        """Test that GitHub is tried first when folder is set"""
        from modal_apps.workflow_executor import SequenceLoader

        mock_load.return_value = """---
tool_name: execute_sequence
arguments:
  steps: []
"""

        workflow_data = {
            'github_folder': 'testworkflow',
            'github_ref': 'main',
            'automation_sequence_yaml': 'fallback_yaml',
            'automation_sequence': {'fallback': 'jsonb'}
        }

        result = SequenceLoader.load_workflow_sequence(workflow_data)

        # Should have used GitHub
        mock_load.assert_called_once_with('testworkflow', 'main')
        assert isinstance(result, list)

    @patch('modal_apps.lib.github_loader.GitHubWorkflowLoader.load_workflow')
    def test_fallback_to_database(self, mock_load):
        """Test fallback to database when GitHub fails"""
        from modal_apps.workflow_executor import SequenceLoader

        # GitHub returns None
        mock_load.return_value = None

        workflow_data = {
            'github_folder': 'testworkflow',
            'github_ref': 'main',
            'automation_sequence_yaml': """---
tool_name: execute_sequence
arguments:
  steps: []
""",
            'automation_sequence': None
        }

        result = SequenceLoader.load_workflow_sequence(workflow_data)

        # Should have fallen back to YAML column
        assert isinstance(result, list)
        mock_load.assert_called_once()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
