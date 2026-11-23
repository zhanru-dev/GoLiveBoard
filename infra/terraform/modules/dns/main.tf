# The site's DNS (docs/06, section 5), in a Route 53 hosted zone: the site
# itself, who may issue its certificates, and what receivers need to trust
# its email (DKIM, SPF through the MAIL FROM domain, DMARC).

resource "aws_route53_zone" "this" {
  count = var.create_zone ? 1 : 0
  name  = var.zone_name
  # checkov:skip=CKV2_AWS_38: DNSSEC needs the registrar's DS record and a KMS key; planned once the domain is chosen.
  # checkov:skip=CKV2_AWS_39: query logging for a demo's zone would log every resolver on the internet.
}

data "aws_route53_zone" "existing" {
  count = var.create_zone ? 0 : 1
  name  = var.zone_name
}

locals {
  zone_id = var.create_zone ? aws_route53_zone.this[0].zone_id : data.aws_route53_zone.existing[0].zone_id
}

resource "aws_route53_record" "site" {
  # checkov:skip=CKV2_AWS_23: it points at the host's Elastic IP, passed in as an address; checkov cannot see the attachment.
  zone_id = local.zone_id
  name    = var.site_domain
  type    = "A"
  ttl     = 300
  records = [var.site_ipv4]
}

# Only Let's Encrypt (Caddy's default) may issue certificates for the site.
resource "aws_route53_record" "caa" {
  zone_id = local.zone_id
  name    = var.site_domain
  type    = "CAA"
  ttl     = 3600
  records = ["0 issue \"letsencrypt.org\"", "0 issuewild \";\"", "0 iodef \"mailto:${var.security_contact}\""]
}

resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = local.zone_id
  name    = "${var.dkim_tokens[count.index]}._domainkey.${var.site_domain}"
  type    = "CNAME"
  ttl     = 3600
  records = ["${var.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = local.zone_id
  name    = var.mail_from_domain
  type    = "MX"
  ttl     = 3600
  records = ["10 feedback-smtp.${var.ses_region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = local.zone_id
  name    = var.mail_from_domain
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:amazonses.com -all"]
}

# Reports go to the security contact; mail failing both DKIM and SPF
# alignment is rejected.
resource "aws_route53_record" "dmarc" {
  zone_id = local.zone_id
  name    = "_dmarc.${var.site_domain}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:${var.security_contact}"]
}
