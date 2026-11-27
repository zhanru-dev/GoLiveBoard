# The application host (ADR-0010): one ARM instance running Caddy, web, api,
# worker and Valkey with Docker Compose. No SSH key and no port 22: SSM
# Session Manager and Run Command are the only ways in.

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  account   = data.aws_caller_identity.current.account_id
  region    = data.aws_region.current.region
  parameter = "arn:aws:ssm:${local.region}:${local.account}:parameter${var.parameter_path}"
}

resource "aws_security_group" "this" {
  name        = "${var.name}-host"
  description = "HTTP and HTTPS from anywhere; no SSH"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.this.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# Port 80 answers ACME HTTP challenges and redirects to HTTPS.
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.this.id
  description       = "HTTP: ACME challenges and the redirect to HTTPS"
  # checkov:skip=CKV_AWS_260: port 80 must be open for Let's Encrypt's HTTP challenge; Caddy redirects everything else to HTTPS.
  cidr_ipv4   = "0.0.0.0/0"
  ip_protocol = "tcp"
  from_port   = 80
  to_port     = 80
}

# Out to anywhere: stream checks and webhooks reach customers' servers, which
# can be anywhere (their own SSRF checks run in the application), plus ECR,
# SSM, S3, SES, the database and Anthropic.
# The description: AWS allows only a-z A-Z 0-9, spaces and ._-:/()#,@[]+=&;{}!$*
# in it, so no apostrophes.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.this.id
  description       = "Everything out: customer streams and webhook receivers can be anywhere"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_iam_role" "host" {
  name = "${var.name}-host"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# What the host itself does, and nothing more (docs/06, section 5).
resource "aws_iam_role_policy" "host" {
  name = "goliveboard-host"
  role = aws_iam_role.host.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PullImagesToken"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid      = "PullImages"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = var.repository_arns
      },
      {
        Sid      = "ReadConfiguration"
        Effect   = "Allow"
        Action   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
        Resource = [local.parameter, "${local.parameter}/*"]
      },
      {
        Sid      = "DecryptConfiguration"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${local.region}.amazonaws.com" }
        }
      },
      {
        Sid      = "AssetsObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${var.assets_bucket_arn}/*"
      },
      {
        Sid      = "AssetsList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = var.assets_bucket_arn
      },
      {
        Sid      = "ReadReleases"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${var.releases_bucket_arn}/*"
      },
      {
        Sid      = "SendEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = var.ses_arns
      },
    ]
  })
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.name}-host"
  role = aws_iam_role.host.name
}

resource "aws_instance" "host" {
  ami                  = data.aws_ssm_parameter.al2023_arm64.value
  instance_type        = var.instance_type
  subnet_id            = var.subnet_id
  iam_instance_profile = aws_iam_instance_profile.host.name

  vpc_security_group_ids = [aws_security_group.this.id]

  # IMDSv2 only. Two hops, because the containers sign S3 URLs and send
  # mail with this role (ADR-0010): from Docker's bridge network a token
  # response needs a second hop, and with one the SDK finds no credentials
  # (every upload and email failed until 27 November 2026). The containers
  # already hold the application's secrets; the role adds the assets bucket,
  # SES and reading those same parameters. The API's readiness check fails
  # without credentials, so a deploy cannot go live without them.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  monitoring    = false
  ebs_optimized = true

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    compose_version = var.compose_version
    compose_sha256  = var.compose_sha256
    deploy_document = var.deploy_document_name
    watchdog_script = trimspace(file("${path.module}/watchdog.sh"))
  })
  user_data_replace_on_change = true

  # A new AMI does not replace a running host by itself: that is a planned
  # change (the releases and Valkey's queues live on it).
  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = "${var.name}-host" }
  # checkov:skip=CKV_AWS_126: detailed monitoring costs more than its one-minute metrics are worth here; Grafana watches the application.
  # checkov:skip=CKV2_AWS_41: it has a role (aws_iam_instance_profile.host); checkov does not follow the reference.
}

# A stable address: DNS points at it, and customers can allow it for stream
# checks and webhooks (docs/runbooks/stream-false-outages.md).
resource "aws_eip" "host" {
  domain   = "vpc"
  instance = aws_instance.host.id
  tags     = { Name = "${var.name}-host" }
}
