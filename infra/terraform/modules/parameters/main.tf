# The environment's configuration in Parameter Store (docs/06, section 6),
# under one path the host reads at each deploy and renders into an env file
# only root can read. Secrets are generated here and stored as SecureString
# (KMS, the account's aws/ssm key); they are also in Terraform's state,
# which is encrypted and reachable only by administrators and the plan and
# deploy roles.
#
# Not created here, because only a person may hold them: add them by hand
# under the same path (docs/runbooks/rotate-a-secret.md):
#   ANTHROPIC_API_KEY             (SecureString), with AI_PROVIDER=anthropic
#   SENTRY_DSN                    (String)
#   OTEL_EXPORTER_OTLP_ENDPOINT   (String), Grafana Cloud's OTLP endpoint
#   OTEL_EXPORTER_OTLP_HEADERS    (SecureString), its Authorization header

resource "random_password" "database" {
  length  = 40
  special = false
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

# 32 random bytes, base64: an AES-256 key (WEBHOOK_ENCRYPTION_KEY).
resource "random_bytes" "webhook_key" {
  length = 32
}

locals {
  # The database's CA bundle is mounted at this path in the containers, so
  # the connection is verified, not only encrypted (rds.force_ssl).
  database_url = "postgres://opspilot:${random_password.database.result}@${var.database_address}:${var.database_port}/opspilot?sslmode=verify-full&sslrootcert=${var.database_ca_path}"

  secrets = {
    DATABASE_URL           = local.database_url
    JWT_SECRET             = random_password.jwt.result
    WEBHOOK_ENCRYPTION_KEY = random_bytes.webhook_key.base64
  }

  settings = merge({
    APP_ORIGIN            = var.site_origin
    SITE_HOST             = trimprefix(var.site_origin, "https://")
    SES_REGION            = var.region
    S3_BUCKET             = var.assets_bucket
    S3_REGION             = var.region
    MAIL_TRANSPORT        = "ses"
    MAIL_FROM             = var.mail_from
    SES_CONFIGURATION_SET = var.ses_configuration_set
    SENTRY_ENVIRONMENT    = var.environment
    DEMO_MODE             = tostring(var.demo_mode)
    AI_PROVIDER           = var.ai_provider
  }, var.extra_settings)
}

resource "aws_ssm_parameter" "secret" {
  for_each = local.secrets
  name     = "${var.path}/${each.key}"
  type     = "SecureString"
  value    = each.value
  # checkov:skip=CKV_AWS_337: the account's aws/ssm key; a customer-managed key adds cost, not protection here.
}

resource "aws_ssm_parameter" "setting" {
  # checkov:skip=CKV2_AWS_34: these are plain settings (origin, bucket, flags); every secret is a SecureString above.
  for_each = local.settings
  name     = "${var.path}/${each.key}"
  type     = "String"
  value    = each.value
}
