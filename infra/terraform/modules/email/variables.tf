variable "name" {
  type = string
}

variable "domain" {
  description = "The domain mail is sent from, e.g. goliveboard.example.com."
  type        = string
}

variable "mail_from_subdomain" {
  type    = string
  default = "mail"
}
