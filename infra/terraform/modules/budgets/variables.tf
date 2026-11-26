variable "name" {
  type = string
}

variable "monthly_usd" {
  type = number
}

variable "alert_email" {
  type = string
}

variable "region" {
  description = "Where the instances to stop run."
  type        = string
}

variable "stop_at_usd" {
  description = "Actual spend in a month at which the host and database are stopped. null: never."
  type        = number
  default     = null
  validation {
    condition     = var.stop_at_usd == null || try(var.stop_at_usd > var.monthly_usd, false)
    error_message = "Stop above the monthly budget, so its alerts come first."
  }
}

variable "ec2_instance_ids" {
  description = "Instances the cost guard stops."
  type        = list(string)
  default     = []
}

variable "rds_instance_ids" {
  description = "Database instance identifiers the cost guard stops."
  type        = list(string)
  default     = []
}

variable "anomaly_usd" {
  description = "Total impact of a cost anomaly worth an email."
  type        = number
  default     = 5
}
