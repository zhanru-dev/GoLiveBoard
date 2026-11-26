# Cost emergency: stop, find the cause, start again

**When:** spend climbs faster than the demo should cost: a budget alert at 80% or 100%, a cost anomaly email, or the email saying AWS Budgets has stopped the host and the database. The demo runs on one fixed-size host and one small database with no autoscaling, so traffic alone makes the site slow, not the bill large. What does make the bill large is data transfer out, resources nobody meant to create, or leaked credentials.

## Symptoms

- **AWS Budgets** emails at 50%, 80% and 100% of the monthly budget (`monthly_budget_usd`), and when the forecast passes 100%.
- **Cost Anomaly Detection** emails once a day about spend by service that is unusual and adds up to $5 or more.
- **The cost guard**: past `stop_spending_at_usd` of actual spend in a month (default: twice the budget), AWS Budgets stops the EC2 host and the RDS database by itself and emails that it did. The site is then down: no proxy answers.

Billing data lags by up to a day, so spend can pass the limit before anything stops: the guard is a brake, not a ceiling.

## Checks

1. **Which service, which usage?** Billing and Cost Management → Cost Explorer: last 14 days, daily, grouped by **Service**, then by **Usage type**.

   ```sh
   aws ce get-cost-and-usage --region us-east-1 \
     --time-period Start=$(date -u -v-14d +%F),End=$(date -u +%F) \
     --granularity DAILY --metrics UnblendedCost \
     --group-by Type=DIMENSION,Key=SERVICE
   ```

2. **Is it traffic?** Usage types ending in `DataTransfer-Out-Bytes` (EC2 or S3). The host's network out is in CloudWatch (`NetworkOut` for the instance); requests are in Caddy's logs (`docker compose logs proxy` through Session Manager).
3. **Is it something nobody created?** Resources in any service the demo does not use, or in another region (the organisation's policy allows only a few regions, so look there first): Resource Explorer, or **EC2 → Global view**.
4. **Are credentials leaked?** CloudTrail → Event history: `CreateAccessKey`, `CreateUser`, `RunInstances`, `CreateRole` by anyone but you or the deploy role. `aws iam list-users` should list no users the demo does not need; the pipeline uses roles, never keys.
5. **Did the guard run?** Budgets → the budget → **Actions**: each action's status (`EXECUTION_SUCCESS` means it stopped the instances).

## Actions

### Stop it now

If the guard has not already done it, stop the host and the database by hand. Data stays: the instance keeps its disk and address, RDS keeps its storage and backups.

```sh
aws ec2 stop-instances --instance-ids "$(terraform -chdir=infra/terraform/environments/demo output -raw host_instance_id)"
aws rds stop-db-instance --db-instance-identifier goliveboard-demo
```

To stop new releases too, set the repository variable `DEPLOY_ENABLED` to `false`.

### If it is traffic

Keep the site stopped while the traffic lasts; the demo does not need to stay up at any price. Before starting it again, consider putting CloudFront's flat-rate Free plan in front, which has no overage charges, and allowing only CloudFront to reach the host.

### If credentials leaked

1. Deactivate and delete any access key you did not create; delete users and roles nobody meant to create, and whatever they launched.
2. For the demo's roles: IAM → the role → **Revoke active sessions**.
3. Rotate the application's secrets: [Rotate a secret](rotate-a-secret.md).
4. Open a case with AWS Support (Account and billing): they can review charges caused by unauthorised use.

### Start again

1. Find and remove the cause first, or the guard stops everything again.
2. The guard runs once per budget period. To restart in the same month, either raise `stop_spending_at_usd` and `terraform apply`, or accept that it will not stop anything again until next month (Budgets → Actions → the action → **Reset** rearms it; while spend is above the limit it then stops everything again at once).
3. Start the database, wait until it is `available`, then the host:

   ```sh
   aws rds start-db-instance --db-instance-identifier goliveboard-demo
   aws rds wait db-instance-available --db-instance-identifier goliveboard-demo
   aws ec2 start-instances --instance-ids <instance id>
   ```

   Docker starts at boot and restarts the containers; the watchdog restarts any that stay unhealthy.

4. Set `DEPLOY_ENABLED` back to `true` if you changed it.

**A stopped RDS instance starts again by itself after seven days.** If the demo should stay down longer, stop it again each week, or take a final snapshot and delete it.

## Verification

- `curl -s https://goliveboard.zhanru.dev/api/v1/health/ready` answers `ok`, with the database and Valkey up.
- Cost Explorer shows the daily cost back to its usual level the next day.
- The budget's actions are back to `STANDBY` (rearmed) or the new limit is applied.

## Rehearsals

| Date | Where | Result |
| ---- | ----- | ------ |
