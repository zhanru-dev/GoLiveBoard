mock_provider "aws" {}

variables {
  name                     = "opspilot-test"
  vpc_id                   = "vpc-0123456789abcdef0"
  subnet_ids               = ["subnet-0aaaaaaaaaaaaaaa0", "subnet-0bbbbbbbbbbbbbbb0"]
  client_security_group_id = "sg-0123456789abcdef0"
  password                 = "not-a-real-password-for-tests"
}

run "the_database_is_private_encrypted_and_recoverable" {
  command = plan

  assert {
    condition     = !aws_db_instance.this.publicly_accessible
    error_message = "The database must never be reachable from the internet."
  }
  assert {
    condition     = aws_db_instance.this.storage_encrypted
    error_message = "Storage must be encrypted."
  }
  assert {
    condition     = aws_db_instance.this.backup_retention_period >= 7
    error_message = "Point-in-time recovery for at least seven days (docs/06, section 8)."
  }
  assert {
    condition     = aws_db_instance.this.deletion_protection && !aws_db_instance.this.skip_final_snapshot
    error_message = "Deleting the database needs two deliberate steps, and leaves a snapshot."
  }
}

run "only_the_host_connects_and_only_over_tls" {
  command = plan

  assert {
    condition     = aws_vpc_security_group_ingress_rule.from_host.referenced_security_group_id == "sg-0123456789abcdef0" && aws_vpc_security_group_ingress_rule.from_host.cidr_ipv4 == null
    error_message = "Only the host's security group may connect, never an address range."
  }
  assert {
    condition     = one([for p in aws_db_parameter_group.this.parameter : p.value if p.name == "rds.force_ssl"]) == "1"
    error_message = "Connections without TLS must be refused."
  }
}
