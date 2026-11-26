mock_provider "aws" {}
mock_provider "random" {}

# Generated values are only known after apply; fixed ones let the plan show
# how the URL is put together.
override_resource {
  target          = random_password.database
  override_during = plan
  values          = { result = "generatedpassword" }
}

variables {
  path                  = "/goliveboard/test"
  environment           = "test"
  region                = "eu-west-2"
  site_origin           = "https://goliveboard.example.com"
  database_address      = "db.example.internal"
  database_port         = 5432
  assets_bucket         = "assets"
  mail_from             = "GoLiveBoard <no-reply@goliveboard.example.com>"
  ses_configuration_set = "goliveboard-test"
}

run "every_secret_is_a_securestring" {
  command = plan

  assert {
    condition     = toset(keys(aws_ssm_parameter.secret)) == toset(["DATABASE_URL", "JWT_SECRET", "WEBHOOK_ENCRYPTION_KEY"])
    error_message = "The generated secrets are the database URL, the JWT key and the webhook key."
  }
  assert {
    condition     = alltrue([for p in aws_ssm_parameter.secret : p.type == "SecureString"])
    error_message = "Secrets are SecureString."
  }
  assert {
    condition     = length(setintersection(keys(aws_ssm_parameter.setting), keys(aws_ssm_parameter.secret))) == 0
    error_message = "No secret is also written as a plain setting."
  }
}

run "the_database_url_verifies_the_server" {
  command = plan

  assert {
    condition     = strcontains(nonsensitive(aws_ssm_parameter.secret["DATABASE_URL"].value), "sslmode=verify-full")
    error_message = "The connection must verify the database's certificate."
  }
}

run "an_unknown_ai_provider_is_refused" {
  command = plan
  variables {
    ai_provider = "openai"
  }
  expect_failures = [var.ai_provider]
}
