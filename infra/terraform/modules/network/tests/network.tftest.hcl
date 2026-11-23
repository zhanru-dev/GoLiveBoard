mock_provider "aws" {}

variables {
  name = "opspilot-test"
}

# IDs are only known after apply; the public subnet gets a fixed one so the
# association can be compared during the plan.
override_resource {
  target          = aws_subnet.public
  override_during = plan
  values          = { id = "subnet-public" }
}

run "the_database_subnets_have_no_way_out" {
  command = plan

  assert {
    condition     = aws_route_table_association.public.subnet_id == aws_subnet.public.id
    error_message = "Only the public subnet uses the route to the internet."
  }
  assert {
    condition     = alltrue([for s in aws_subnet.private : s.map_public_ip_on_launch == false])
    error_message = "Nothing in the private subnets gets a public address."
  }
  assert {
    condition     = length(aws_subnet.private) == 2 && aws_subnet.private[0].availability_zone != aws_subnet.private[1].availability_zone
    error_message = "The database's subnets span two zones."
  }
}
