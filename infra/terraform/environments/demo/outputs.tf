output "site_url" {
  value = "https://${var.site_domain}"
}

output "host_public_ip" {
  value = module.compute.public_ip
}

output "host_instance_id" {
  value = module.compute.instance_id
}

output "name_servers" {
  description = "Set these at the registrar when the zone was created here."
  value       = module.dns.name_servers
}

output "deploy_role_arn" {
  description = "AWS_DEPLOY_ROLE_ARN in the GitHub environment \"demo\"."
  value       = module.github_oidc.deploy_role_arn
}

output "plan_role_arn" {
  value = module.github_oidc.plan_role_arn
}

output "repository_urls" {
  value = module.registry.repository_urls
}

output "releases_bucket" {
  value = module.storage.releases_bucket
}

output "deploy_document" {
  value = aws_ssm_document.deploy.name
}

output "parameter_path" {
  value = local.path
}
