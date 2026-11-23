# The demo's network (docs/06, section 5): one public subnet for the host,
# and private subnets for the database, which has no route to or from the
# internet. No NAT gateway: the host has a public address of its own, and
# the database needs none (docs/07, risks: cost).

# Named, not looked up: the subnets must not move when AWS adds a zone.
locals {
  zones = var.availability_zones
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

# The default security group lets members talk to each other; nothing uses
# it, so it allows nothing at all.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, 0)
  availability_zone = local.zones[0]
  # The host gets its address from an Elastic IP, not from the subnet.
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-public" }
}

# Two zones: RDS asks for a subnet group spanning them, even single-AZ.
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, 10 + count.index)
  availability_zone = local.zones[count.index]
  # Nothing here gets a public address; there is no route out either.
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# The private subnets keep the VPC's main route table: local routes only.

# Flow logs of rejected traffic only, kept a fortnight: enough to see what
# knocked, at a few pence a month.
resource "aws_flow_log" "rejected" {
  vpc_id               = aws_vpc.this.id
  traffic_type         = "REJECT"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow.arn
  iam_role_arn         = aws_iam_role.flow.arn
}

resource "aws_cloudwatch_log_group" "flow" {
  # checkov:skip=CKV_AWS_158: CloudWatch's own encryption is enough for rejected-packet metadata.
  # checkov:skip=CKV_AWS_338: a fortnight answers "what was knocking?"; a year costs for nothing.
  name              = "/opspilot/${var.name}/vpc-flow-rejected"
  retention_in_days = 14
}

resource "aws_iam_role" "flow" {
  name = "${var.name}-vpc-flow-logs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "flow" {
  name = "write-flow-logs"
  role = aws_iam_role.flow.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
      Resource = "${aws_cloudwatch_log_group.flow.arn}:*"
    }]
  })
}
