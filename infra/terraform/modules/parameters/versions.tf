terraform {
  required_version = ">= 1.17.1, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.72.0, < 7.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.9.1, < 4.0.0"
    }
  }
}
