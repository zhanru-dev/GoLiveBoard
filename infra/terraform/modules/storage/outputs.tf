output "assets_bucket" {
  value = aws_s3_bucket.this["assets"].id
}

output "assets_bucket_arn" {
  value = aws_s3_bucket.this["assets"].arn
}

output "releases_bucket" {
  value = aws_s3_bucket.this["releases"].id
}

output "releases_bucket_arn" {
  value = aws_s3_bucket.this["releases"].arn
}
