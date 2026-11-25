variable "assets_bucket" {
  description = "Name of the assets bucket (global, so it carries something of your own)."
  type        = string
}

variable "releases_bucket" {
  description = "Name of the releases bucket."
  type        = string
}

variable "site_origin" {
  description = "The site's origin, e.g. https://opspilot.example.com: the only one allowed to upload."
  type        = string
}
