# Terraform: the AWS demo environment

The infrastructure of [ADR-0010](../../docs/adr/0010-aws-deployment.md) and [docs/06, section 5](../../docs/06-infrastructure-and-operations.md#5-aws-infrastructure-terraform), in `eu-west-2`:

- **Compute:** one ARM EC2 host (Docker Compose, SSM only, no SSH).
- **Data:** RDS PostgreSQL 18 in private subnets; S3 for assets and releases.
- **Services:** SES with DKIM, ECR, Parameter Store, Route 53.
- **Access and cost:** the GitHub OIDC roles; AWS Budgets.

| Directory                        | What it is                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`                     | The state bucket and GitHub's OIDC provider. Applied once, by a person, with local state                                                |
| `modules/`                       | One module per concern: `network`, `database`, `compute`, `storage`, `email`, `registry`, `github-oidc`, `dns`, `budgets`, `parameters` |
| `environments/demo/`             | The demo environment, wiring the modules; state in the bootstrap's bucket                                                               |
| `../deploy/host-deploy.sh.tftpl` | The deploy script, installed on the host as the SSM document `goliveboard-demo-deploy`                                                  |

## Checks, without an AWS account

```bash
bash scripts/infra-check.sh          # or: fmt | validate | test | lint | scan
```

Every tool runs in a container pinned by digest:

- **Terraform 1.17.1:** `fmt`, `validate`, and `test` with mocked providers;
- **tflint 0.66.0** with the AWS ruleset;
- **checkov 3.4.3.**

CI runs the same script (the "Infrastructure" job).

**What the tests hold:**

- who may assume the GitHub roles (this repository; deploys only from the `demo` environment);
- IMDSv2 with one hop;
- a private, encrypted database with TLS required and 7 days of recovery;
- buckets that cannot be made public and refuse plain HTTP;
- immutable image tags;
- secrets stored as SecureString;
- the deploy document's parameter checks.

Each of these was checked by a mutation that makes its test fail.

**Skipped checks:** every check checkov skips has its reason beside it in the code. Most are costs declined at demo scale (customer-managed KMS keys, Multi-AZ, cross-region replication), each named in ADR-0010's consequences.

## First apply, in order

Each step creates billed resources; the demo's budget is set in step 3.

1. **Before anything else (days ahead):**
   - an AWS account, with an administrator you sign in as (`aws sso login`);
   - the domain;
   - a **request for SES production access**, made in the SES console. Until AWS grants it, mail reaches verified addresses only.
2. **Bootstrap:**

   ```bash
   cd infra/terraform/bootstrap
   terraform init
   terraform apply -var state_bucket=goliveboard-terraform-state-<something of your own>
   ```

3. **The environment:**
   - Copy `backend.hcl.example` to `backend.hcl` and `terraform.tfvars.example` to `terraform.tfvars`, and fill them in. Both are git-ignored.
   - Check how the repository's OIDC tokens name it: `gh api repos/OWNER/GoLiveBoard/actions/oidc/customization/sub`. If `use_immutable_subject` is true, set `github_oidc_subject_prefix` to its `sub_claim_prefix`. Without it, the deploy fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
   - Then run:

     ```bash
     cd infra/terraform/environments/demo
     terraform init -backend-config=backend.hcl
     terraform apply
     ```

   - If the zone was created here, set the registrar's NS records to the `name_servers` output.
4. **By hand, never through Terraform or CI.** Add these values in Parameter Store, under the `parameter_path` output:
   - `ANTHROPIC_API_KEY` (SecureString), if `ai_provider = "anthropic"`;
   - `SENTRY_DSN`;
   - `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` (SecureString), for Grafana Cloud;
   - `SIGN_UP_CODES` (SecureString), to make sign-up by invitation only: digests of invite codes, never the codes ([Issue or withdraw an invite code](../../docs/runbooks/issue-an-invite-code.md)). Without it, anyone can create a workspace.
5. **GitHub:**
   - Create the environment `demo`, limited to the `main` branch.
   - Set its variables from the outputs:
     - `AWS_DEPLOY_ROLE_ARN` (`deploy_role_arn`);
     - `AWS_REGION` (`eu-west-2`);
     - `ECR_REGISTRY` (the host part of `repository_urls`);
     - `RELEASES_BUCKET` (`releases_bucket`);
     - `HOST_INSTANCE_ID` (`host_instance_id`);
     - `DEPLOY_DOCUMENT` (`deploy_document`);
     - `SITE_URL` (`site_url`).
   - Last, set the **repository** variable `DEPLOY_ENABLED` to `true` (a repository variable, not the environment's: the workflow reads it before it picks the environment). Until then the deploy workflow skips, so a repository without AWS shows no failed runs.
   - The deploy workflow does the rest on every merge to `main` (docs/06, section 4).

**Later changes:** every later change to this directory goes through review. A merge that touches `infra/terraform/environments` is applied by a person until the plan and apply jobs are added to CI with the plan role.
