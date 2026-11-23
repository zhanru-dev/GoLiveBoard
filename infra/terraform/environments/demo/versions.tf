terraform {
  required_version = ">= 1.17.1, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
  }

  # The bucket comes from the bootstrap; backend blocks cannot read variables:
  #   terraform init -backend-config=backend.hcl   (see backend.hcl.example)
  backend "s3" {
    key          = "demo/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "opspilot", Environment = var.environment, ManagedBy = "terraform" }
  }
}
