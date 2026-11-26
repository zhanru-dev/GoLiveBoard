# Restore the database to a point in time

**When:** data was lost or corrupted (a bad migration, a mistaken delete, a bug that wrote wrong data), and the moment before it is known.

**Targets** (docs/06, section 8): recovery point within 5 minutes, recovery time under 1 hour.

## Symptoms

- Users or support report missing or wrong data.
- The audit trail shows a deletion nobody meant, or data no longer matches it.
- A migration failed halfway, or did what it should not have.

## Checks

1. **What is wrong, and since when?** Use the audit trail (`/audit`), the API's logs and the deploy history to find the last moment the data was right. Write it down in UTC: that is the **target time**.
2. **Is it still happening?** If a release causes it, roll it back first ([deploy-and-roll-back.md](deploy-and-roll-back.md)) so the restore is not undone.
3. **How much was written since?** Everything after the target time is lost by a restore, good writes included. If they matter, export them first (by query, with the audit trail as the guide) to apply again afterwards.

## Actions

**In AWS** (RDS, milestone 10):

1. **Restore to the target time.** In the RDS console or the CLI:
   ```bash
   # The network and settings come from the damaged instance: a restore
   # does not copy them, and without them RDS uses the default VPC's subnets
   # and security group, which the EC2 host cannot reach (docs/06, section 5).
   aws rds describe-db-instances --db-instance-identifier goliveboard-demo \
     --query 'DBInstances[0].[DBSubnetGroup.DBSubnetGroupName, VpcSecurityGroups[].VpcSecurityGroupId, DBParameterGroups[0].DBParameterGroupName, DBInstanceClass]'

   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier goliveboard-demo \
     --target-db-instance-identifier goliveboard-demo-restored \
     --restore-time <target time, UTC, e.g. 2026-11-19T01:37:10Z> \
     --db-subnet-group-name <from above> \
     --vpc-security-group-ids <from above> \
     --db-parameter-group-name <from above> \
     --db-instance-class <from above> \
     --no-publicly-accessible \
     --copy-tags-to-snapshot
   aws rds wait db-instance-available --db-instance-identifier goliveboard-demo-restored
   ```
   This makes a **new** instance; the damaged one stays as it was, for comparison. Terraform does not know the new instance: milestone 10's version of this runbook adds the step that brings it under Terraform (an import, or renaming it to the original identifier once the damaged one is kept as a snapshot).
2. **Check the new instance** (see Verification).
3. **Point the services at it.** Change the database endpoint in Parameter Store, then redeploy, so the API and the worker restart with it.
4. **Keep the damaged instance** for a week, then delete it.

**Locally:**

- The stack's PostgreSQL does not archive WAL, so it can only go back to a dump.
- The mechanism RDS uses (a base backup plus the archived WAL, replayed to a target time) is rehearsed with [`scripts/pitr-rehearsal.sh`](scripts/pitr-rehearsal.sh), on the same PostgreSQL image.

## Verification

- The restored database has the rows that were lost, and nothing after the target time.
- `npx prisma migrate status` against it shows every migration applied.
- `/api/v1/health/ready` is `200`; sign in, open an event, and check the data the incident was about.
- The audit trail ends at the target time.

## Rehearsals

| Date       | Where                                                       | What                                                                                                                | Result                                                                                                            |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local, `postgres:18.6-alpine` (`scripts/pitr-rehearsal.sh`) | WAL archived and a base backup taken. A row written after the backup; the target time noted; then every row deleted | A new server restored from the backup and the archive to the target time: **both rows back, the deletion undone** |
