# RDS PostgreSQL for the demo (docs/06, sections 5 and 8): single-AZ,
# encrypted, private, with seven days of point-in-time recovery. Only the
# host's security group reaches it.

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "this" {
  name        = "${var.name}-database"
  description = "PostgreSQL, from the application host only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_host" {
  security_group_id            = aws_security_group.this.id
  description                  = "PostgreSQL from the application host"
  referenced_security_group_id = var.client_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_parameter_group" "this" {
  name   = var.name
  family = "postgres${var.engine_major_version}"

  # Connections without TLS are refused (the URL asks for it too).
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Statements slower than a second are logged, with their duration.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  # PostgreSQL 18 made this a list of connection stages; "1" is refused.
  parameter {
    name  = "log_connections"
    value = "all"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_major_version
  instance_class = var.instance_class

  db_name  = "goliveboard"
  username = "goliveboard"
  password = var.password

  allocated_storage     = 20
  max_allocated_storage = 50
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  publicly_accessible    = false
  # A single zone fits the demo's 99.5% objective (ADR-0010); a second is
  # one argument away when it is worth paying for.
  # checkov:skip=CKV_AWS_157: single-AZ by decision (ADR-0010), for cost.
  multi_az = false

  parameter_group_name       = aws_db_parameter_group.this.name
  auto_minor_version_upgrade = true
  maintenance_window         = "sun:04:30-sun:05:30"

  # Point-in-time recovery for a week (docs/06, section 8). The window is
  # before the 03:00 demo reset's busiest hour has any effect worth keeping.
  backup_retention_period  = 7
  backup_window            = "02:00-02:30"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  enabled_cloudwatch_logs_exports       = ["postgresql"]
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  # checkov:skip=CKV_AWS_118: enhanced monitoring's extra role and cost buy little over Performance Insights here.
  # checkov:skip=CKV_AWS_161: IAM database authentication would replace one password with token plumbing on one host.
  # checkov:skip=CKV_AWS_354: Performance Insights uses the AWS-managed key; a customer key adds cost, not protection.
  # checkov:skip=CKV2_AWS_30: query logging is the slow-statement log above.
}
