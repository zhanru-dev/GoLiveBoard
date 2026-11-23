# The roles GitHub Actions assumes with its OIDC token (ADR-0010): no AWS
# keys are stored anywhere. Each trusts this repository only:
# - deploy: jobs in the GitHub environment "demo", which only main may use
#   (the environment's branch rule); pushes images, uploads the release's
#   files, and runs the deploy document on the host;
# - plan: pull requests and main; reads everything Terraform needs for a
#   plan, and may take and release the state lock, nothing else.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
  issuer  = "token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }
    # The job runs in the "demo" environment of this repository.
    condition {
      test     = "StringEquals"
      variable = "${local.issuer}:sub"
      values   = ["repo:${var.repository}:environment:${var.deploy_environment}"]
    }
  }
}

data "aws_iam_policy_document" "plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.issuer}:sub"
      values = [
        "repo:${var.repository}:pull_request",
        "repo:${var.repository}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role" "plan" {
  name                 = "${var.name}-github-plan"
  assume_role_policy   = data.aws_iam_policy_document.plan_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "PushImages"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages",
    ]
    resources = var.repository_arns
  }
  statement {
    sid       = "UploadRelease"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.releases_bucket_arn}/*"]
  }
  # Run the deploy document, on the host only.
  statement {
    sid     = "RunDeploy"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account}:document/${var.deploy_document_name}",
      var.instance_arn,
    ]
  }
  statement {
    sid       = "FollowDeploy"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# Plans read every resource Terraform manages; ReadOnlyAccess covers them
# without listing each service, and holds no secret values' plaintext
# except through the state, which the policy below opens.
resource "aws_iam_role_policy_attachment" "plan_read" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  statement {
    sid       = "ReadState"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [var.state_bucket_arn, "${var.state_bucket_arn}/*"]
  }
  # S3-native locking: a lock file beside the state.
  statement {
    sid       = "StateLock"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.state_bucket_arn}/*.tflock"]
  }
  # SecureString values appear in a plan's refresh.
  statement {
    sid       = "ReadParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${local.region}:${local.account}:parameter${var.parameter_path}/*"]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}
