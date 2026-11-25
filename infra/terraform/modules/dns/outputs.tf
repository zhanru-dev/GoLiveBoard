output "zone_id" {
  value = local.zone_id
}

output "name_servers" {
  description = "Set these at the registrar when the zone is created here."
  value       = var.create_zone ? aws_route53_zone.this[0].name_servers : []
}
