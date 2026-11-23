# The deploy document's parameters reach a root shell on the host: each is
# checked by SSM before anything runs.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "eu-west-2" }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_sesv2_email_identity" {
    defaults = { dkim_signing_attributes = [{ tokens = ["a", "b", "c"] }] }
  }
}
mock_provider "random" {}

# The document embeds the releases bucket's name, known only after apply.
override_resource {
  target          = module.storage.aws_s3_bucket.this
  override_during = plan
  values          = { id = "opspilot-test-releases", arn = "arn:aws:s3:::opspilot-test-releases" }
}

variables {
  site_domain              = "opspilot.example.com"
  zone_name                = "example.com"
  bucket_prefix            = "opspilot-test"
  state_bucket             = "state"
  github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  github_repository        = "owner/repo"
  alert_email              = "ops@example.com"
}

run "the_deploy_document_takes_only_a_listed_action_and_a_full_sha" {
  command = plan

  assert {
    condition     = jsondecode(aws_ssm_document.deploy.content).parameters.Sha.allowedPattern == "^([0-9a-f]{40})?$"
    error_message = "The SHA must be 40 hex digits or empty: nothing else reaches the shell."
  }
  assert {
    condition     = toset(jsondecode(aws_ssm_document.deploy.content).parameters.Action.allowedValues) == toset(["migrate", "deploy", "current"])
    error_message = "The action must come from the list."
  }
  assert {
    condition     = strcontains(jsondecode(aws_ssm_document.deploy.content).mainSteps[0].inputs.runCommand[3], "SHA='{{ Sha }}'")
    error_message = "Parameters are passed quoted, as the script's environment."
  }
}
