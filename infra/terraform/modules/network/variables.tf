variable "name" {
  description = "Prefix for the network's resources."
  type        = string
}

variable "availability_zones" {
  description = "Two zones: the host's subnet is in the first; the database's subnets span both."
  type        = list(string)
  default     = ["eu-west-2a", "eu-west-2b"]
  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Exactly two availability zones."
  }
}

variable "cidr" {
  description = "The VPC's address range; subnets are /24s inside it."
  type        = string
  default     = "10.40.0.0/16"
}
