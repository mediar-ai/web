# Azure Infrastructure for VNC Gateway
# Alternative to GCP Cloud Run - same region as VMs for lower latency
#
# Benefits over GCP:
#   - Same cloud as VMs (Azure eastus) = lower latency
#   - No cross-cloud traffic
#   - Simpler networking
#
# To deploy:
#   cd infra/azure
#   terraform init
#   terraform apply -var-file="terraform.tfvars"

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Resource group for VNC gateway"
  type        = string
  default     = "mediar-vnc-gateway-rg"
}

variable "supabase_url" {
  description = "Supabase project URL"
  type        = string
}

variable "supabase_key" {
  description = "Supabase API key (anon key)"
  type        = string
  sensitive   = true
}

variable "vnc_password" {
  description = "VNC password (must match TightVNC on VMs)"
  type        = string
  sensitive   = true
}

variable "acr_name" {
  description = "Azure Container Registry name"
  type        = string
  default     = "mediarvncgateway"
}

provider "azurerm" {
  features {}
}

# =============================================================================
# RESOURCE GROUP
# =============================================================================

resource "azurerm_resource_group" "vnc" {
  name     = var.resource_group_name
  location = var.location

  tags = {
    environment = "production"
    purpose     = "vnc-gateway"
    managed_by  = "terraform"
  }
}

# =============================================================================
# CONTAINER REGISTRY - Store VNC gateway image
# =============================================================================

resource "azurerm_container_registry" "vnc" {
  name                = var.acr_name
  resource_group_name = azurerm_resource_group.vnc.name
  location            = azurerm_resource_group.vnc.location
  sku                 = "Basic"
  admin_enabled       = true

  tags = {
    environment = "production"
    purpose     = "vnc-gateway"
  }
}

# =============================================================================
# VNC GATEWAY - Azure Container Instance
# =============================================================================

resource "azurerm_container_group" "vnc_gateway" {
  name                = "vnc-gateway"
  location            = azurerm_resource_group.vnc.location
  resource_group_name = azurerm_resource_group.vnc.name
  os_type             = "Linux"
  ip_address_type     = "Public"
  dns_name_label      = "mediar-vnc-gateway"

  image_registry_credential {
    server   = azurerm_container_registry.vnc.login_server
    username = azurerm_container_registry.vnc.admin_username
    password = azurerm_container_registry.vnc.admin_password
  }

  container {
    name   = "vnc-gateway"
    image  = "${azurerm_container_registry.vnc.login_server}/vnc-gateway:latest"
    cpu    = "1"
    memory = "1"

    ports {
      port     = 8080
      protocol = "TCP"
    }

    environment_variables = {
      "PORT"         = "8080"
      "SUPABASE_URL" = var.supabase_url
    }

    secure_environment_variables = {
      "SUPABASE_KEY"  = var.supabase_key
      "VNC_PASSWORD"  = var.vnc_password
    }

    # Health check
    liveness_probe {
      http_get {
        path   = "/health"
        port   = 8080
        scheme = "Http"
      }
      initial_delay_seconds = 30
      period_seconds        = 30
      failure_threshold     = 3
    }

    readiness_probe {
      http_get {
        path   = "/health"
        port   = 8080
        scheme = "Http"
      }
      initial_delay_seconds = 10
      period_seconds        = 10
      failure_threshold     = 3
    }
  }

  # Restart policy - always restart on failure
  restart_policy = "Always"

  tags = {
    environment = "production"
    purpose     = "vnc-web-gateway"
    managed_by  = "terraform"
  }
}

# =============================================================================
# OUTPUTS
# =============================================================================

output "vnc_gateway_fqdn" {
  value       = azurerm_container_group.vnc_gateway.fqdn
  description = "VNC Gateway FQDN (use with https:// for web access)"
}

output "vnc_gateway_ip" {
  value       = azurerm_container_group.vnc_gateway.ip_address
  description = "VNC Gateway public IP"
}

output "acr_login_server" {
  value       = azurerm_container_registry.vnc.login_server
  description = "ACR login server for pushing images"
}

output "acr_admin_username" {
  value       = azurerm_container_registry.vnc.admin_username
  description = "ACR admin username"
  sensitive   = true
}
