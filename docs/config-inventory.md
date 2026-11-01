# Configuration and secrets inventory

Names and locations only, never values. The config loader is `packages/core/src/config/params.ts`: Parameter Store `/s10-marketing/<env>/<kebab-name>` maps to `UPPER_SNAKE` keys (e.g. `/s10-marketing/dev/app-url` → `APP_URL`), and the process environment overrides it.

## Parameter Store (created by CDK as of M1.1)
| Parameter | Key | Source |
|---|---|---|
| `/s10-marketing/<env>/token-kms-key-arn` | `TOKEN_KMS_KEY_ARN` | CoreStack |
| `/s10-marketing/<env>/media-bucket` | `MEDIA_BUCKET` | CoreStack |
| `/s10-marketing/<env>/publish-queue-url` | `PUBLISH_QUEUE_URL` | CoreStack |
| `/s10-marketing/<env>/ingest-queue-url` | `INGEST_QUEUE_URL` | CoreStack |
| `/s10-marketing/<env>/ops-alert-topic-arn` | `OPS_ALERT_TOPIC_ARN` | CoreStack |
| `/s10-marketing/<env>/meta-graph-version` | `META_GRAPH_VERSION` (`v26.0`) | CoreStack |
| `/s10-marketing/<env>/publishing-enabled` | `PUBLISHING_ENABLED` (`false`) | CoreStack, kill switch |
| `/s10-marketing/<env>/automation-enabled` | `AUTOMATION_ENABLED` (`false`) | CoreStack, kill switch |

Not yet created: `app-url` (after the Vercel domain is known), DB, Cognito, Meta, AI (`ai-model-generate` = Claude Sonnet 5.5, `ai-model-fast` = Claude Haiku 5.5 inference profiles), SES and Scheduler parameters arrive with their milestones (05 §5).

## Vercel environment variables (project `s10-marketing`; not secrets)
| Name | Preview + Development | Production |
|---|---|---|
| `APP_ENV` | `dev` | `prod` |
| `AWS_ROLE_ARN` | `s10-marketing-dev-web-runtime` role ARN (VercelAccessStack) | `s10-marketing-prod-web-runtime` role ARN |

Vercel sets `VERCEL_GIT_COMMIT_SHA` (used for `/api/health` version) and provides the OIDC token automatically.

## Secrets Manager (created manually by the owner, never via CDK or Git)
| Name | Purpose | Milestone |
|---|---|---|
| `s10-marketing/<env>/meta-app-secret` | Meta code exchange, `appsecret_proof` | M1.4 |

## GitHub repository/environment variables (not secrets)
`AWS_DEV_DIFF_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` (per environment), `OPS_ALERT_EMAIL`.

## Local only (`.env.local`, git-ignored)
See `.env.example`.
