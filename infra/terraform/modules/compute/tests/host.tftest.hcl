mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_region" {
    defaults = { region = "eu-west-2" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

variables {
  name                 = "goliveboard-test"
  vpc_id               = "vpc-0123456789abcdef0"
  subnet_id            = "subnet-0123456789abcdef0"
  repository_arns      = ["arn:aws:ecr:eu-west-2:123456789012:repository/goliveboard-api"]
  parameter_path       = "/goliveboard/test"
  assets_bucket_arn    = "arn:aws:s3:::assets"
  releases_bucket_arn  = "arn:aws:s3:::releases"
  ses_arns             = ["arn:aws:ses:eu-west-2:123456789012:identity/example.com"]
  deploy_document_name = "goliveboard-test-deploy"
}

run "the_host_requires_imdsv2_and_containers_cannot_reach_its_credentials" {
  command = plan

  assert {
    condition     = aws_instance.host.metadata_options[0].http_tokens == "required"
    error_message = "IMDSv1 must be off."
  }
  assert {
    condition     = aws_instance.host.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "A hop limit of 1 keeps containers from the instance's credentials."
  }
}

run "the_host_has_no_ssh_and_an_encrypted_disk" {
  command = plan

  assert {
    condition     = aws_instance.host.root_block_device[0].encrypted
    error_message = "The root volume must be encrypted."
  }
  assert {
    condition = toset([
      aws_vpc_security_group_ingress_rule.http.from_port,
      aws_vpc_security_group_ingress_rule.https.from_port,
    ]) == toset([80, 443])
    error_message = "Only HTTP and HTTPS come in."
  }
}

run "the_host_reads_only_its_own_configuration" {
  command = plan

  assert {
    condition = toset(one([
      for s in jsondecode(aws_iam_role_policy.host.policy).Statement : s.Resource if s.Sid == "ReadConfiguration"
      ])) == toset([
      "arn:aws:ssm:eu-west-2:123456789012:parameter/goliveboard/test",
      "arn:aws:ssm:eu-west-2:123456789012:parameter/goliveboard/test/*",
    ])
    error_message = "The host may read its own parameter path only."
  }
  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.host.policy).Statement : s.Condition if s.Sid == "DecryptConfiguration"
    ]) == { StringEquals = { "kms:ViaService" = "ssm.eu-west-2.amazonaws.com" } }
    error_message = "KMS decryption only through Parameter Store."
  }
}

run "the_host_installs_the_watchdog_and_runs_it_every_30_seconds" {
  command = plan

  assert {
    condition     = strcontains(aws_instance.host.user_data, trimspace(file("watchdog.sh")))
    error_message = "The first boot must install watchdog.sh as it is."
  }
  assert {
    condition     = strcontains(aws_instance.host.user_data, "OnUnitActiveSec=30s") && strcontains(aws_instance.host.user_data, "systemctl enable --now goliveboard-watchdog.timer")
    error_message = "The watchdog's timer must be enabled, every 30 seconds."
  }
}
