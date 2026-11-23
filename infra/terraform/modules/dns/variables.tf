variable "zone_name" {
  description = "The hosted zone, e.g. example.com (or opspilot.example.com for a delegated subdomain)."
  type        = string
}

variable "create_zone" {
  description = "Create the zone (then point the registrar's NS records at it), or use one that exists."
  type        = bool
  default     = true
}

variable "site_domain" {
  description = "The site's name, e.g. opspilot.example.com."
  type        = string
}

variable "site_ipv4" {
  type = string
}

variable "dkim_tokens" {
  type = list(string)
}

variable "mail_from_domain" {
  type = string
}

variable "ses_region" {
  type = string
}

variable "security_contact" {
  description = "Receives DMARC reports and certificate-issuance problems."
  type        = string
}
