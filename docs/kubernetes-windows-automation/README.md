# Kubernetes Windows Automation Implementation

This directory contains the implementation files for the Kubernetes-based Windows automation agent system.

## Architecture Overview

### Container-Agent Relationship (1:1)

```
┌─────────────────────────────────────┐
│         Kubernetes Cluster          │
│                                     │
│  ┌─────────────────┐  ┌────────────┐│
│  │   Pod/Container  │  │Pod/Container││
│  │  ┌────────────┐  │  │ ┌────────┐ ││
│  │  │Windows Agent│  │  │ │Windows │ ││
│  │  │   (ID: 1)   │  │  │ │Agent   │ ││
│  │  │             │  │  │ │(ID: 2) │ ││
│  │  │ ◉ Desktop   │  │  │ │        │ ││
│  │  │ ◉ Terminator│  │  │ │◉Desktop│ ││
│  │  │ ◉ MCP Server│  │  │ │◉Term...│ ││
│  │  └────────────┘  │  │ └────────┘ ││
│  └─────────────────┘  └────────────┘│
│                                     │
│         One Agent Per Container     │
└─────────────────────────────────────┘
```

**Key Points:**
- Each container runs exactly ONE Windows automation agent
- Each agent has exclusive control over its container's Windows desktop session
- Scaling is achieved by adding more containers, not more agents per container
- This prevents UI control conflicts and ensures predictable behavior

## Directory Structure

```
kubernetes-windows-automation/
├── README.md                    # This file
├── mcp-server/                  # MCP server wrapper for terminator
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── index.ts            # MCP server implementation
├── k8s/                        # Kubernetes manifests
│   ├── namespace.yaml
│   ├── secrets.yaml
│   ├── windows-agent-deployment.yaml
│   ├── windows-agent-service.yaml
│   ├── windows-agent-hpa.yaml
│   └── prometheus-config.yaml
├── docker/                     # Docker configuration
│   ├── Dockerfile.windows      # Windows container image
│   └── .dockerignore
├── scripts/                    # Helper scripts
│   ├── start-agent.ps1        # Windows agent startup script
│   └── build-and-push.sh      # Build and push container image
└── tests/                      # Test files
    ├── agent-manager.test.ts
    └── integration.test.ts
```

## Implementation Notes

### Windows Container Requirements

1. **Base Image**: Uses `mcr.microsoft.com/windows/servercore:ltsc2022`
2. **UI Access**: Requires UI automation features enabled
3. **Memory**: Minimum 4GB per container
4. **CPU**: Minimum 2 cores per container

### MCP Server Integration

The MCP server wrapper (`mcp-server/`) provides:
- HTTP/SSE endpoint for MCP protocol
- Integration with terminator for UI automation
- Health and readiness checks for Kubernetes
- Session management for workflow execution

### Scaling Strategy

1. **Horizontal Pod Autoscaler (HPA)**:
   - Scales based on CPU, memory, and active workflows
   - Minimum 2 pods, maximum 20 pods
   - Target: 2 workflows per pod (queue others)

2. **Agent Allocation**:
   - Each workflow gets a dedicated container
   - Containers are marked as "busy" during execution
   - Released back to pool after workflow completion

### Security Considerations

1. **Network Isolation**: Each container in its own network namespace
2. **Resource Limits**: Enforced CPU/memory limits per container
3. **Authentication**: JWT tokens for MCP endpoint access
4. **RBAC**: Limited Kubernetes permissions for agent pods

### Monitoring

Metrics exposed for Prometheus:
- `windows_agent_total`: Total number of agents
- `windows_agent_available`: Available agents
- `windows_agent_busy`: Busy agents
- `workflow_executions_total`: Total workflow executions
- `workflow_execution_duration_seconds`: Execution duration histogram
- `agent_provision_duration_seconds`: Time to provision new agent

## Quick Start

1. **Build the Windows container image**:
   ```bash
   cd docker
   docker build -f Dockerfile.windows -t mediar/windows-automation-agent:latest .
   ```

2. **Deploy to Kubernetes**:
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/secrets.yaml
   kubectl apply -f k8s/
   ```

3. **Verify deployment**:
   ```bash
   kubectl get pods -n automation
   kubectl logs -n automation -l app=windows-automation-agent
   ```

## Troubleshooting

### Common Issues

1. **Container fails to start**:
   - Check Windows node availability
   - Verify base image compatibility
   - Review container logs

2. **MCP server not responding**:
   - Check health endpoint: `http://<pod-ip>:3000/health`
   - Verify terminator installation
   - Check PowerShell startup script logs

3. **UI automation failures**:
   - Ensure UI automation features are enabled
   - Check for desktop session availability
   - Verify no other processes are controlling UI

### Debug Commands

```bash
# Get pod details
kubectl describe pod <pod-name> -n automation

# Access pod shell
kubectl exec -it <pod-name> -n automation -- powershell

# Check MCP server logs
kubectl logs <pod-name> -n automation -c automation-agent

# Test MCP endpoint
kubectl port-forward <pod-name> 3000:3000 -n automation
curl http://localhost:3000/health
```