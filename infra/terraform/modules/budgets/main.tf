# AWS Budgets (docs/06, section 5): email at 50%, 80% and 100% of the
# month's budget actually spent, and when the forecast passes 100%. Below:
# the cost guard, and anomaly detection.

resource "aws_budgets_budget" "monthly" {
  name         = var.name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# ------------------------------------------------------------ cost guard
#
# A demo has no need to stay up at any price: past a hard limit of actual
# spend, AWS Budgets stops the host and the database itself (docs/runbooks/
# cost-emergency.md). Billing data lags by up to a day, so this is a brake,
# not a ceiling. Stopped instances keep their disks and address, which still
# cost a little; a stopped RDS instance starts again by itself after seven
# days, which the runbook covers.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  stop_enabled = var.stop_at_usd != null
}

data "aws_iam_policy_document" "budgets_trust" {
  count = local.stop_enabled ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    # Only this account's budgets, not anyone else's, can use the role.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "budget_action" {
  count              = local.stop_enabled ? 1 : 0
  name               = "${var.name}-budget-stop"
  assume_role_policy = data.aws_iam_policy_document.budgets_trust[0].json
}

# The policy AWS publishes for exactly this: running its own Stop automation
# documents for EC2 and RDS. Budgets can only run those documents.
resource "aws_iam_role_policy_attachment" "budget_action" {
  count      = local.stop_enabled ? 1 : 0
  role       = aws_iam_role.budget_action[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AWSBudgetsActions_RolePolicyForResourceAdministrationWithSSM"
}

resource "aws_budgets_budget_action" "stop" {
  for_each = local.stop_enabled ? {
    STOP_EC2_INSTANCES = var.ec2_instance_ids
    STOP_RDS_INSTANCES = var.rds_instance_ids
  } : {}

  budget_name        = aws_budgets_budget.monthly.name
  action_type        = "RUN_SSM_DOCUMENTS"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_action[0].arn

  action_threshold {
    action_threshold_type  = "ABSOLUTE_VALUE"
    action_threshold_value = var.stop_at_usd
  }

  definition {
    ssm_action_definition {
      action_sub_type = each.key
      instance_ids    = each.value
      region          = var.region
    }
  }

  subscriber {
    address           = var.alert_email
    subscription_type = "EMAIL"
  }
}

# Spend that does not look like the usual pattern, by service, before it adds
# up: an email the next day for anything that adds a few dollars.
resource "aws_ce_anomaly_monitor" "services" {
  name              = "${var.name}-services"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "email" {
  name             = "${var.name}-anomalies"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.anomaly_usd)]
    }
  }
}
