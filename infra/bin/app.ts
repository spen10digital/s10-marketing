import { App } from 'aws-cdk-lib';
import { resolveEnvConfig } from '../lib/env-config';
import { buildApp } from '../lib/app';

// Context only (env, alertEmail, githubRepo, vercelTeam); the account comes from the active SSO profile.
const context = new App({ autoSynth: false }).node;
const config = resolveEnvConfig({
  env: context.tryGetContext('env'),
  alertEmail: context.tryGetContext('alertEmail'),
  githubRepo: context.tryGetContext('githubRepo'),
  vercelTeam: context.tryGetContext('vercelTeam'),
});

const { app } = buildApp({ config, account: process.env.CDK_DEFAULT_ACCOUNT });
app.synth();
