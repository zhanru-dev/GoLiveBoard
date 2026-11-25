# Two private buckets (docs/06, section 5):
# - assets: holding slates, uploaded from browsers with presigned PUTs and
#   shown with presigned GETs; versioned, so a deletion can be undone for
#   30 days (docs/06, section 8);
# - releases: one docker-compose file and Caddyfile per deployed commit,
#   written by the deploy pipeline and read by the host, so a rollback
#   deploys exactly what ran before.

locals {
  buckets = {
    assets   = var.assets_bucket
    releases = var.releases_bucket
  }
}

resource "aws_s3_bucket" "this" {
  # checkov:skip=CKV_AWS_144: one region; assets can be re-uploaded, releases rebuilt from git.
  # checkov:skip=CKV_AWS_18: S3 access logs for a demo would cost more attention than they repay; CloudTrail records management calls.
  # checkov:skip=CKV2_AWS_62: nothing listens for these buckets' events.
  # checkov:skip=CKV_AWS_145: SSE-S3 encrypts them; a customer-managed key adds cost, not protection here.
  # checkov:skip=CKV2_AWS_61: each bucket has a lifecycle configuration (assets, releases below); checkov cannot match for_each keys.
  for_each = local.buckets
  bucket   = each.value
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.buckets
  bucket                  = aws_s3_bucket.this[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.this["assets"].id
  rule {
    id     = "undo-window"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket = aws_s3_bucket.this["releases"].id
  rule {
    id     = "old-releases"
    status = "Enabled"
    filter {}
    expiration {
      days = 180
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Browsers upload holding slates straight to the bucket, and show them, from
# the site's origin only.
resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.this["assets"].id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = [var.site_origin]
    allowed_headers = ["content-type", "content-length"]
    max_age_seconds = 600
  }
}

resource "aws_s3_bucket_policy" "tls_only" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}
