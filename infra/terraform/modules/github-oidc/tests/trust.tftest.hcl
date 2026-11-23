# Who may assume the roles: this repository only, deploys from the "demo"
# environment only, plans from pull requests and main only.

mock_provider "aws" {
  # The documents' statements are what is tested; their rendered JSON only
  # has to be a policy for the roles to accept it.
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_region" {
    defaults = { region = "eu-west-2" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

variables {
  name                 = "opspilot-test"
  oidc_provider_arn    = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  repository           = "owner/repo"
  repository_arns      = ["arn:aws:ecr:eu-west-2:123456789012:repository/opspilot-api"]
  releases_bucket_arn  = "arn:aws:s3:::releases"
  deploy_document_name = "opspilot-test-deploy"
  instance_arn         = "arn:aws:ec2:eu-west-2:123456789012:instance/i-0123456789abcdef0"
  state_bucket_arn     = "arn:aws:s3:::state"
  parameter_path       = "/opspilot/test"
}

run "deploy_trusts_only_the_demo_environment_of_this_repository" {
  command = plan

  assert {
    condition = toset(one([
      for c in data.aws_iam_policy_document.deploy_trust.statement[0].condition : c.values
      if c.variable == "token.actions.githubusercontent.com:sub"
    ])) == toset(["repo:owner/repo:environment:demo"])
    error_message = "The deploy role must trust only jobs in the demo environment of this repository."
  }
  assert {
    condition = one([
      for c in data.aws_iam_policy_document.deploy_trust.statement[0].condition : c.test
      if c.variable == "token.actions.githubusercontent.com:sub"
    ]) == "StringEquals"
    error_message = "The subject must match exactly, never as a pattern."
  }
  assert {
    condition = toset(one([
      for c in data.aws_iam_policy_document.deploy_trust.statement[0].condition : c.values
      if c.variable == "token.actions.githubusercontent.com:aud"
    ])) == toset(["sts.amazonaws.com"])
    error_message = "The token's audience must be STS."
  }
}

run "plan_trusts_only_pull_requests_and_main" {
  command = plan

  assert {
    condition = toset(one([
      for c in data.aws_iam_policy_document.plan_trust.statement[0].condition : c.values
      if c.variable == "token.actions.githubusercontent.com:sub"
    ])) == toset(["repo:owner/repo:pull_request", "repo:owner/repo:ref:refs/heads/main"])
    error_message = "The plan role must trust only this repository's pull requests and main."
  }
}

run "deploy_runs_only_its_document_on_the_host" {
  command = plan

  assert {
    condition = toset(one([
      for s in data.aws_iam_policy_document.deploy.statement : s.resources if s.sid == "RunDeploy"
      ])) == toset([
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:document/opspilot-test-deploy",
      "arn:aws:ec2:eu-west-2:123456789012:instance/i-0123456789abcdef0",
    ])
    error_message = "ssm:SendCommand must be limited to the deploy document and the host."
  }
  assert {
    condition = alltrue([
      for s in data.aws_iam_policy_document.deploy.statement : !contains(s.actions, "*") && !contains(s.actions, "ssm:*")
    ])
    error_message = "The deploy role gets named actions only."
  }
}

run "plan_writes_only_the_state_lock" {
  command = plan

  assert {
    condition = toset(one([
      for s in data.aws_iam_policy_document.plan_state.statement : s.resources if s.sid == "StateLock"
    ])) == toset(["arn:aws:s3:::state/*.tflock"])
    error_message = "The plan role may write only lock files, never the state."
  }
}
