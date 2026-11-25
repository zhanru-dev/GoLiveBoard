mock_provider "aws" {}

# ARNs are only known after apply; a fixed one lets the policies render.
override_resource {
  target          = aws_s3_bucket.this
  override_during = plan
  values          = { arn = "arn:aws:s3:::bucket", id = "bucket" }
}

variables {
  assets_bucket   = "opspilot-test-assets"
  releases_bucket = "opspilot-test-releases"
  site_origin     = "https://opspilot.example.com"
}

run "no_bucket_can_be_made_public" {
  command = plan

  assert {
    condition = alltrue([
      for b in aws_s3_bucket_public_access_block.this :
      b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets
    ])
    error_message = "Every bucket blocks public access, all four ways."
  }
  assert {
    condition     = length(aws_s3_bucket_public_access_block.this) == 2
    error_message = "Both buckets have a public access block."
  }
}

run "buckets_refuse_plain_http_and_uploads_come_from_the_site_only" {
  command = plan

  assert {
    condition = alltrue([
      for p in aws_s3_bucket_policy.tls_only :
      jsondecode(p.policy).Statement[0].Effect == "Deny" &&
      jsondecode(p.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    ])
    error_message = "Requests without TLS are denied."
  }
  assert {
    condition     = [for rule in aws_s3_bucket_cors_configuration.assets.cors_rule : toset(rule.allowed_origins)] == [toset(["https://opspilot.example.com"])]
    error_message = "Browsers may upload from the site's origin only."
  }
}
