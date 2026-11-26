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

variable "subject_prefix" {
  description = <<-EOT
    How the repository's tokens begin their sub claim, when it is not
    repo:owner/name. A repository with immutable subjects adds the owner's
    and its own numeric IDs, so a renamed or recreated repository of the
    same name is not trusted: repo:owner@123/name@456. GitHub reports it:
    gh api repos/OWNER/NAME/actions/oidc/customization/sub (sub_claim_prefix).
  EOT
  type        = string
  default     = null
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
