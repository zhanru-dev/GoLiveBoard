output "database_password" {
  value     = random_password.database.result
  sensitive = true
}

output "path" {
  value = var.path
}
