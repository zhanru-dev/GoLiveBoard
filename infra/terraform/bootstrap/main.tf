# Applied once, by a person with administrator access, before anything else
# (docs/06, section 5): the bucket that holds every other configuration's
# state, and the identity provider that lets GitHub Actions assume roles
# without stored keys. Its own state stays local: there is nowhere else to
# keep it yet, and it changes almost never.
#
#   terraform -chdir=infra/terraform/bootstrap init
#   terraform -chdir=infra/terraform/bootstrap apply -var state_bucket=<globally unique name>

terraform {
  required_version = ">= 1.17.1, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "opspilot", ManagedBy = "terraform", Stack = "bootstrap" }
  }
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "state_bucket" {
  description = "Name of the bucket for Terraform state; bucket names are global, so it carries something of your own."
  type        = string
}

resource "aws_s3_bucket" "state" {
  # checkov:skip=CKV_AWS_144: one region is enough for state that can be rebuilt from code.
  # checkov:skip=CKV_AWS_18: access logs for a bucket only Terraform touches would log Terraform.
  # checkov:skip=CKV2_AWS_62: nothing listens for this bucket's events.
  # checkov:skip=CKV_AWS_145: SSE-S3 encrypts it; a customer-managed key adds cost, not protection here.
  bucket = var.state_bucket
  # Losing the state means importing every resource again by hand.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Only TLS: state holds secrets (generated passwords and keys).
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# GitHub's OIDC issuer. AWS verifies its certificates itself; the thumbprint
# list is no longer used for this provider but the API still takes one.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
