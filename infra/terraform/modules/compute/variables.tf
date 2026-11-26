variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  description = "The public subnet."
  type        = string
}

variable "instance_type" {
  description = "ARM (Graviton); t4g.small carried NFR-4's load on two vCPUs in the local measurement."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gb" {
  type    = number
  default = 30
}

variable "repository_arns" {
  description = "ECR repositories the host pulls from."
  type        = list(string)
}

variable "parameter_path" {
  description = "Parameter Store path of the environment's configuration, e.g. /goliveboard/demo."
  type        = string
}

variable "assets_bucket_arn" {
  type = string
}

variable "releases_bucket_arn" {
  type = string
}

variable "ses_arns" {
  description = "SES identity and configuration set the host may send through."
  type        = list(string)
}

variable "deploy_document_name" {
  type = string
}

variable "compose_version" {
  type    = string
  default = "v5.7.0"
}

variable "compose_sha256" {
  description = "SHA-256 of docker-compose-linux-aarch64 for compose_version, from the release's checksums.txt."
  type        = string
  default     = "15861535d14e26555736b49376c95e14bfd94285366c8446bfac7156a972e76f"
}
