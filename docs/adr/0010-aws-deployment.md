# ADR-0010: Single EC2 host with RDS, deployed by Terraform and GitHub OIDC

- Status: Accepted
- Date: 2026-11-09

## Context

The demo environment must be always available, reproducible, secure and affordable for a portfolio project, while demonstrating the AWS skills common in UK job descriptions. The capacity target (NFR-4) fits on one modest instance.

## Decision

In `eu-west-2` (London):

- one ARM EC2 instance runs Caddy, web, api, worker and Valkey with Docker Compose; access only through SSM Session Manager, no SSH;
- RDS for PostgreSQL in private subnets, encrypted, with point-in-time recovery;
- S3 for assets, SES for email, ECR for images, Parameter Store for secrets;
- everything defined in Terraform, with state in S3 using native locking;
- GitHub Actions assumes narrowly scoped roles through OIDC (no stored AWS keys), pushes images and deploys through SSM Run Command.

## Consequences

- Low fixed cost, with AWS Budgets alerts.
- The database, the hardest part to operate, is managed; everything on the host can be rebuilt from images and Terraform.
- A single host is a single point of failure for the application tier; acceptable for the demo's 99.5% objective.
- Moving to ECS Fargate, an Application Load Balancer and ElastiCache needs infrastructure changes only, because the containers and configuration are already production-shaped.

## Alternatives considered

- **ECS Fargate with ALB and ElastiCache from the start**: the production-grade target, but several times the fixed monthly cost for no benefit at demo scale.
- **Vercel for web plus a separate API host**: easy for Next.js, but splits origins (see ADR-0003) and shows less AWS.
- **Render or Fly.io**: simpler, but UK job descriptions ask for AWS far more often.
- **Kubernetes (EKS)**: far beyond what the product needs.
