output "identity_arn" {
  value = aws_sesv2_email_identity.domain.arn
}

output "configuration_set_arn" {
  value = aws_sesv2_configuration_set.this.arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}

output "dkim_tokens" {
  value = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}

output "mail_from_domain" {
  value = aws_sesv2_email_identity_mail_from_attributes.domain.mail_from_domain
}

output "region" {
  value = data.aws_region.current.region
}
