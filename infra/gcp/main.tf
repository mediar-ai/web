# GCP Infrastructure for MCP Agent containers
# Migrating from Azure Container Instances to GCP Cloud Run
#
# IMPORTANT: After deploying, update VM OTEL_COLLECTOR_ENDPOINT to use Cloud Run URL:
#   Old: http://otel-collector-mcp-vm2-rg.eastus.azurecontainer.io:4318
#   New: https://otel-collector-xxx-uc.a.run.app (from otel_collector_url output)
#
# Cloud Run differences from Azure Container Instance:
#   - HTTPS only (TLS termination included)
#   - Auto-scaling (min 1, max N instances)
#   - Pay per request (not per hour)
#   - WebSocket support for VNC Gateway

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region"
  type        = string
  default     = "us-east1"
}

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}

# =============================================================================
# ENABLE REQUIRED APIS
# =============================================================================

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# =============================================================================
# ARTIFACT REGISTRY - Container image storage (replaces Azure ACR)
# =============================================================================

resource "google_artifact_registry_repository" "containers" {
  location      = var.gcp_region
  repository_id = "mediar-containers"
  description   = "Container images for MCP infrastructure"
  format        = "DOCKER"

  labels = {
    environment = "production"
    managed_by  = "terraform"
  }

  depends_on = [google_project_service.artifactregistry]
}

# =============================================================================
# OTEL COLLECTOR - Cloud Run service (replaces Azure Container Instance)
# =============================================================================

resource "google_cloud_run_v2_service" "otel_collector" {
  name     = "otel-collector"
  location = var.gcp_region

  template {
    containers {
      image = "otel/opentelemetry-collector-contrib:0.110.0"

      args = ["--config=/config/otel-config.yaml"]

      ports {
        container_port = 4318
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "CLICKHOUSE_PASSWORD"
        value = var.clickhouse_password
      }

      volume_mounts {
        name       = "config"
        mount_path = "/config"
      }
    }

    volumes {
      name = "config"
      secret {
        secret = google_secret_manager_secret.otel_config.secret_id
        items {
          version = "latest"
          path    = "otel-config.yaml"
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }
  }

  labels = {
    environment = "production"
    purpose     = "mcp-telemetry"
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.otel_config_accessor
  ]
}

# Secret for OTEL config
resource "google_secret_manager_secret" "otel_config" {
  secret_id = "otel-collector-config"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "otel_config" {
  secret      = google_secret_manager_secret.otel_config.id
  secret_data = file("${path.module}/../otel-collector/otel-config.yaml")
}

# Grant Cloud Run service account access to secret
data "google_project" "current" {}

resource "google_secret_manager_secret_iam_member" "otel_config_accessor" {
  secret_id = google_secret_manager_secret.otel_config.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

# Allow unauthenticated access (VMs need to send telemetry)
resource "google_cloud_run_v2_service_iam_member" "otel_public" {
  name     = google_cloud_run_v2_service.otel_collector.name
  location = google_cloud_run_v2_service.otel_collector.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# =============================================================================
# VNC GATEWAY - Cloud Run service (replaces Azure Container Instance)
# =============================================================================

resource "google_cloud_run_v2_service" "vnc_gateway" {
  name     = "vnc-gateway"
  location = var.gcp_region

  template {
    containers {
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project}/mediar-containers/vnc-gateway:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "SUPABASE_KEY"
        value = var.supabase_api_key
      }
      env {
        name  = "VNC_PASSWORD"
        value = var.vnc_password
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 3
    }
  }

  labels = {
    environment = "production"
    purpose     = "vnc-web-gateway"
  }
}

# Allow unauthenticated access (web clients connect)
resource "google_cloud_run_v2_service_iam_member" "vnc_public" {
  name     = google_cloud_run_v2_service.vnc_gateway.name
  location = google_cloud_run_v2_service.vnc_gateway.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# =============================================================================
# RUST EXECUTOR - Cloud Run service (replaces Azure Container Instance)
# =============================================================================

resource "google_cloud_run_v2_service" "rust_executor" {
  name     = "workflow-executor"
  location = var.gcp_region

  template {
    containers {
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project}/mediar-containers/workflow-executor:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      # Core config
      env {
        name  = "RUST_LOG"
        value = "workflow_executor=debug,tower_http=debug,info"
      }
      env {
        name  = "ENVIRONMENT"
        value = "production"
      }

      # Database
      env {
        name  = "DATABASE_URL"
        value = var.database_url
      }

      # MCP Server
      env {
        name  = "MCP_ENDPOINT"
        value = var.mcp_endpoint
      }

      # Supabase
      env {
        name  = "SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "SUPABASE_SERVICE_ROLE_KEY"
        value = var.supabase_service_role_key
      }

      # OTEL - points to our GCP Cloud Run collector
      env {
        name  = "OTEL_SDK_ENABLED"
        value = "true"
      }
      env {
        name  = "OTEL_EXPORTER_OTLP_ENDPOINT"
        value = google_cloud_run_v2_service.otel_collector.uri
      }

      # App integration
      env {
        name  = "APP_URL"
        value = var.app_url
      }
      env {
        name  = "MEDIAR_SERVICE_API_KEY"
        value = var.mediar_service_api_key
      }
      env {
        name  = "MCP_SERVICE_TOKEN"
        value = var.mcp_service_token
      }
      env {
        name  = "SECRETS_ENCRYPTION_KEY"
        value = var.secrets_encryption_key
      }

      # GCP metadata
      env {
        name  = "GCP_PROJECT"
        value = var.gcp_project
      }
      env {
        name  = "GCP_REGION"
        value = var.gcp_region
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }

    # Increase startup timeout for Rust binary
    timeout = "300s"
  }

  labels = {
    environment = "production"
    purpose     = "workflow-executor"
  }

  depends_on = [
    google_project_service.run,
    google_cloud_run_v2_service.otel_collector
  ]
}

# Allow internal access only (Next.js app calls this)
resource "google_cloud_run_v2_service_iam_member" "executor_public" {
  name     = google_cloud_run_v2_service.rust_executor.name
  location = google_cloud_run_v2_service.rust_executor.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# =============================================================================
# VARIABLES
# =============================================================================

variable "clickhouse_password" {
  description = "ClickHouse password for OTEL exporter"
  type        = string
  sensitive   = true
}

variable "supabase_url" {
  description = "Supabase project URL"
  type        = string
}

variable "supabase_api_key" {
  description = "Supabase API key (anon key for VNC gateway)"
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service role key for Rust executor"
  type        = string
  sensitive   = true
}

variable "database_url" {
  description = "PostgreSQL database URL for Rust executor"
  type        = string
  sensitive   = true
}

variable "mcp_endpoint" {
  description = "MCP server endpoint URL"
  type        = string
}

variable "app_url" {
  description = "Main web app URL for callbacks"
  type        = string
  default     = "https://app.mediar.ai"
}

variable "mediar_service_api_key" {
  description = "API key for Mediar service"
  type        = string
  sensitive   = true
  default     = ""
}

variable "mcp_service_token" {
  description = "Token for MCP service workflow downloads"
  type        = string
  sensitive   = true
  default     = ""
}

variable "secrets_encryption_key" {
  description = "Key for encrypting secrets"
  type        = string
  sensitive   = true
  default     = ""
}

variable "vnc_password" {
  description = "Password for VNC authentication (must match TightVNC on VMs)"
  type        = string
  sensitive   = true
}

# =============================================================================
# OUTPUTS
# =============================================================================

output "otel_collector_url" {
  value       = google_cloud_run_v2_service.otel_collector.uri
  description = "OTEL Collector URL (Cloud Run)"
}

output "vnc_gateway_url" {
  value       = google_cloud_run_v2_service.vnc_gateway.uri
  description = "VNC Gateway URL (Cloud Run)"
}

output "artifact_registry_url" {
  value       = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project}/${google_artifact_registry_repository.containers.repository_id}"
  description = "Artifact Registry URL for pushing images"
}

output "rust_executor_url" {
  value       = google_cloud_run_v2_service.rust_executor.uri
  description = "Rust Executor URL (Cloud Run)"
}
