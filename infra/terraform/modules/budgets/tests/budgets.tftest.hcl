mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  name             = "goliveboard-test"
  monthly_usd      = 30
  alert_email      = "alerts@example.com"
  region           = "eu-west-2"
  stop_at_usd      = 60
  ec2_instance_ids = ["i-0123456789abcdef0"]
  rds_instance_ids = ["goliveboard-test"]
}

run "past_the_limit_the_host_and_database_stop_without_waiting_for_approval" {
  command = plan

  assert {
    condition     = toset(keys(aws_budgets_budget_action.stop)) == toset(["STOP_EC2_INSTANCES", "STOP_RDS_INSTANCES"])
    error_message = "Both the host and the database are stopped."
  }
  assert {
    condition = alltrue([for action in aws_budgets_budget_action.stop :
      action.approval_model == "AUTOMATIC" && action.notification_type == "ACTUAL"
    ])
    error_message = "Nobody may be awake to approve: the action runs by itself, on spend that happened, not a forecast."
  }
  assert {
    condition = alltrue([for action in aws_budgets_budget_action.stop :
      one(action.action_threshold).action_threshold_type == "ABSOLUTE_VALUE" && one(action.action_threshold).action_threshold_value == 60
    ])
    error_message = "The limit is the configured amount in dollars."
  }
  assert {
    condition     = toset(one(one(aws_budgets_budget_action.stop["STOP_EC2_INSTANCES"].definition).ssm_action_definition).instance_ids) == toset(["i-0123456789abcdef0"]) && toset(one(one(aws_budgets_budget_action.stop["STOP_RDS_INSTANCES"].definition).ssm_action_definition).instance_ids) == toset(["goliveboard-test"])
    error_message = "Each action stops the instances it is given."
  }
}

run "only_this_accounts_budgets_can_use_the_role" {
  command = plan

  assert {
    condition     = toset(one([for s in data.aws_iam_policy_document.budgets_trust[0].statement : one([for c in s.condition : c.values if c.variable == "aws:SourceAccount"])])) == toset(["123456789012"]) && toset(one([for s in data.aws_iam_policy_document.budgets_trust[0].statement : one([for p in s.principals : p.identifiers])])) == toset(["budgets.amazonaws.com"])
    error_message = "The role trusts AWS Budgets, and only on behalf of this account."
  }
}

run "without_a_limit_nothing_is_ever_stopped" {
  command = plan

  variables {
    stop_at_usd = null
  }

  assert {
    condition     = length(aws_budgets_budget_action.stop) == 0 && length(aws_iam_role.budget_action) == 0
    error_message = "No limit means no action and no role."
  }
}

run "the_limit_must_be_above_the_budget" {
  command = plan

  variables {
    stop_at_usd = 30
  }

  expect_failures = [var.stop_at_usd]
}

run "unusual_spend_is_emailed_daily" {
  command = plan

  assert {
    condition     = aws_ce_anomaly_monitor.services.monitor_dimension == "SERVICE" && aws_ce_anomaly_subscription.email.frequency == "DAILY"
    error_message = "Anomalies by service, emailed daily."
  }
  assert {
    condition     = toset(one(one(aws_ce_anomaly_subscription.email.threshold_expression).dimension).values) == toset(["5"])
    error_message = "Anything with an impact of 5 dollars or more is worth an email."
  }
}
