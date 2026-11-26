# The AWS demo environment (ADR-0010, docs/06 section 5), wired from the
# modules. Order of first use: bootstrap, then this, then the deploy
# pipeline (.github/workflows/deploy.yml).

locals {
  name        = "goliveboard-${var.environment}"
  site_origin = "https://${var.site_domain}"
  path        = "/goliveboard/${var.environment}"
  document    = "${local.name}-deploy"
  registry    = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

data "aws_caller_identity" "current" {}

module "network" {
  source = "../../modules/network"
  name   = local.name
}

module "registry" {
  source = "../../modules/registry"
}

module "storage" {
  source          = "../../modules/storage"
  assets_bucket   = "${var.bucket_prefix}-assets"
  releases_bucket = "${var.bucket_prefix}-releases"
  site_origin     = local.site_origin
}

module "email" {
  source = "../../modules/email"
  name   = local.name
  domain = var.site_domain
}

module "compute" {
  source               = "../../modules/compute"
  name                 = local.name
  vpc_id               = module.network.vpc_id
  subnet_id            = module.network.public_subnet_id
  instance_type        = var.instance_type
  repository_arns      = module.registry.repository_arns
  parameter_path       = local.path
  assets_bucket_arn    = module.storage.assets_bucket_arn
  releases_bucket_arn  = module.storage.releases_bucket_arn
  ses_arns             = [module.email.identity_arn, module.email.configuration_set_arn]
  deploy_document_name = local.document
}

module "database" {
  source                   = "../../modules/database"
  name                     = local.name
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.private_subnet_ids
  client_security_group_id = module.compute.security_group_id
  instance_class           = var.database_instance_class
  password                 = module.parameters.database_password
}

module "parameters" {
  source                = "../../modules/parameters"
  path                  = local.path
  environment           = var.environment
  region                = var.region
  site_origin           = local.site_origin
  database_address      = module.database.address
  database_port         = module.database.port
  assets_bucket         = module.storage.assets_bucket
  mail_from             = "GoLiveBoard <no-reply@${var.site_domain}>"
  ses_configuration_set = module.email.configuration_set_name
  demo_mode             = var.demo_mode
  ai_provider           = var.ai_provider
  extra_settings        = var.extra_settings
}

module "dns" {
  source           = "../../modules/dns"
  zone_name        = var.zone_name
  create_zone      = var.create_zone
  site_domain      = var.site_domain
  site_ipv4        = module.compute.public_ip
  dkim_tokens      = module.email.dkim_tokens
  mail_from_domain = module.email.mail_from_domain
  ses_region       = module.email.region
  security_contact = var.alert_email
}

module "github_oidc" {
  source               = "../../modules/github-oidc"
  name                 = local.name
  oidc_provider_arn    = var.github_oidc_provider_arn
  repository           = var.github_repository
  repository_arns      = module.registry.repository_arns
  releases_bucket_arn  = module.storage.releases_bucket_arn
  deploy_document_name = local.document
  instance_arn         = module.compute.instance_arn
  state_bucket_arn     = "arn:aws:s3:::${var.state_bucket}"
  parameter_path       = local.path
}

module "budgets" {
  source           = "../../modules/budgets"
  name             = local.name
  monthly_usd      = var.monthly_budget_usd
  alert_email      = var.alert_email
  region           = var.region
  stop_at_usd      = coalesce(var.stop_spending_at_usd, var.monthly_budget_usd * 2)
  ec2_instance_ids = [module.compute.instance_id]
  rds_instance_ids = [module.database.identifier]
}

# The deploy command (docs/06, section 4), run on the host by the pipeline.
# Both parameters are checked before anything runs: the action from a list,
# the SHA as 40 hex digits, so neither can carry anything into the shell.
resource "aws_ssm_document" "deploy" {
  name            = local.document
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Migrate or deploy one GoLiveBoard release (a commit) on the host"
    parameters = {
      Action = {
        type          = "String"
        allowedValues = ["migrate", "deploy", "current"]
      }
      Sha = {
        type           = "String"
        default        = ""
        allowedPattern = "^([0-9a-f]{40})?$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "release"
      inputs = {
        timeoutSeconds = "900"
        runCommand = [
          "install -d -m 0750 /opt/goliveboard",
          "cat > /opt/goliveboard/deploy.sh <<'GOLIVEBOARD_DEPLOY_SCRIPT'\n${templatefile("${path.module}/../../../deploy/host-deploy.sh.tftpl", {
            document_name   = local.document
            releases_bucket = module.storage.releases_bucket
            region          = var.region
            registry        = local.registry
            parameter_path  = local.path
          })}\nGOLIVEBOARD_DEPLOY_SCRIPT",
          "chmod 0700 /opt/goliveboard/deploy.sh",
          "ACTION='{{ Action }}' SHA='{{ Sha }}' /opt/goliveboard/deploy.sh",
        ]
      }
    }]
  })
}
