# SES for the site's email (docs/06, section 5): the domain identity with
# Easy DKIM, a MAIL FROM subdomain so SPF aligns for DMARC, and a
# configuration set that keeps reputation metrics and suppresses addresses
# that bounce or complain. Production access (leaving the SES sandbox) is a
# request to AWS, not Terraform: docs/runbooks and docs/07 say to make it a
# week ahead.

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = var.name
  reputation_options {
    reputation_metrics_enabled = true
  }
  sending_options {
    sending_enabled = true
  }
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
  delivery_options {
    tls_policy = "REQUIRE"
  }
}

resource "aws_sesv2_email_identity" "domain" {
  email_identity         = var.domain
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = "${var.mail_from_subdomain}.${var.domain}"
  behavior_on_mx_failure = "REJECT_MESSAGE"
}

data "aws_region" "current" {}
