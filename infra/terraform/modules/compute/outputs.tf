output "instance_id" {
  value = aws_instance.host.id
}

output "instance_arn" {
  value = aws_instance.host.arn
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "public_ip" {
  value = aws_eip.host.public_ip
}
