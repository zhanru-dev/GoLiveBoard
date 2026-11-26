variable "path" {
  description = "Parameter Store path, e.g. /goliveboard/demo."
  type        = string
}

variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "site_origin" {
  type = string
}

variable "database_address" {
  type = string
}

variable "database_port" {
  type = number
}

variable "database_ca_path" {
  description = "Where the containers find the RDS CA bundle."
  type        = string
  default     = "/etc/goliveboard/rds-ca.pem"
}

variable "assets_bucket" {
  type = string
}

variable "mail_from" {
  description = "e.g. GoLiveBoard <no-reply@goliveboard.example.com>"
  type        = string
}

variable "ses_configuration_set" {
  type = string
}

variable "demo_mode" {
  type    = bool
  default = true
}

variable "ai_provider" {
  description = "none, offline, or anthropic (then add ANTHROPIC_API_KEY by hand)."
  type        = string
  default     = "offline"
  validation {
    condition     = contains(["none", "offline", "anthropic"], var.ai_provider)
    error_message = "ai_provider is none, offline or anthropic."
  }
}

variable "extra_settings" {
  description = "Further plain settings, e.g. TRIAGE_DAILY_BUDGET_USD."
  type        = map(string)
  default     = {}
}
