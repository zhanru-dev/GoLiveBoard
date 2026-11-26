variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "environment" {
  type    = string
  default = "demo"
}

variable "site_domain" {
  description = "The site's name, e.g. goliveboard.example.com. Mail is sent from it too."
  type        = string
}

variable "zone_name" {
  description = "The Route 53 zone the site's records go in, e.g. example.com."
  type        = string
}

variable "create_zone" {
  description = "Create the zone here (then set the registrar's NS records to the name_servers output)."
  type        = bool
  default     = true
}

variable "bucket_prefix" {
  description = "Prefix for the S3 buckets, which are named globally, e.g. goliveboard-demo-<something of your own>."
  type        = string
}

variable "state_bucket" {
  description = "The bootstrap's state bucket (the plan role may read it and take its lock)."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "From the bootstrap's outputs."
  type        = string
}

variable "github_repository" {
  description = "owner/name of the repository whose Actions may deploy."
  type        = string
}

variable "github_oidc_subject_prefix" {
  description = "The repository's sub claim prefix when it uses immutable subjects (modules/github-oidc), e.g. repo:owner@123/GoLiveBoard@456."
  type        = string
  default     = null
}

variable "alert_email" {
  description = "Receives budget alerts, DMARC reports and certificate notices."
  type        = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 50
}

variable "stop_spending_at_usd" {
  description = "Actual spend in a month at which AWS Budgets stops the host and the database (docs/runbooks/cost-emergency.md). Default: twice the budget."
  type        = number
  default     = null
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "database_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "demo_mode" {
  type    = bool
  default = true
}

variable "ai_provider" {
  description = "none, offline, or anthropic (add ANTHROPIC_API_KEY to Parameter Store by hand)."
  type        = string
  default     = "offline"
}

variable "extra_settings" {
  type    = map(string)
  default = {}
}
