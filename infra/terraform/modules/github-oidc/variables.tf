variable "name" {
  type = string
}

variable "oidc_provider_arn" {
  description = "From the bootstrap configuration."
  type        = string
}

variable "repository" {
  description = "owner/name of the GitHub repository allowed to assume the roles."
  type        = string
}

variable "deploy_environment" {
  description = "The GitHub environment deploy jobs run in; restrict it to main in the repository's settings."
  type        = string
  default     = "demo"
}

variable "repository_arns" {
  type = list(string)
}

variable "releases_bucket_arn" {
  type = string
}

variable "deploy_document_name" {
  type = string
}

variable "instance_arn" {
  type = string
}

variable "state_bucket_arn" {
  type = string
}

variable "parameter_path" {
  type = string
}
