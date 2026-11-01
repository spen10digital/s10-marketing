import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error';
import { loadConfig, parameterNameToKey, parseConfig, publicConfig } from './params';

const ssmMock = mockClient(SSMClient);

beforeEach(() => ssmMock.reset());

describe('parseConfig', () => {
  it('applies safe defaults (publishing off, Graph v26.0, us-east-1)', () => {
    const cfg = parseConfig({ APP_ENV: 'local' });
    expect(cfg.PUBLISHING_ENABLED).toBe(false);
    expect(cfg.AUTOMATION_ENABLED).toBe(false);
    expect(cfg.META_GRAPH_VERSION).toBe('v26.0');
    expect(cfg.AWS_REGION).toBe('us-east-1');
  });

  it('rejects other regions and reports key names without values', () => {
    try {
      parseConfig({ APP_ENV: 'local', AWS_REGION: 'eu-west-1', APP_URL: 'not a url secret-ish' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('CONFIG_INVALID');
      expect((err as AppError).message).toContain('AWS_REGION');
      expect((err as AppError).message).not.toContain('secret-ish');
    }
  });

  it('parses boolean kill switches strictly', () => {
    expect(parseConfig({ APP_ENV: 'local', PUBLISHING_ENABLED: 'true' }).PUBLISHING_ENABLED).toBe(true);
    expect(() => parseConfig({ APP_ENV: 'local', PUBLISHING_ENABLED: 'yes' })).toThrow(AppError);
  });

  it('rejects unknown environments', () => {
    expect(() => parseConfig({ APP_ENV: 'staging' })).toThrow(AppError);
  });
});

describe('parameterNameToKey', () => {
  it('maps parameter paths to config keys', () => {
    expect(parameterNameToKey('/s10-marketing/dev/app-url', '/s10-marketing/dev/')).toBe('APP_URL');
    expect(parameterNameToKey('/s10-marketing/prod/meta/graph-version', '/s10-marketing/prod/')).toBe(
      'META_GRAPH_VERSION',
    );
  });
});

describe('loadConfig', () => {
  it('uses only the environment locally (no AWS calls)', async () => {
    const cfg = await loadConfig({ env: { APP_ENV: 'local', DATABASE_URL: 'postgres://localhost/x' } });
    expect(cfg.DATABASE_URL).toBe('postgres://localhost/x');
    expect(ssmMock.calls()).toHaveLength(0);
  });

  it('reads paginated Parameter Store values in dev; environment overrides them', async () => {
    ssmMock
      .on(GetParametersByPathCommand, { Path: '/s10-marketing/dev/', NextToken: undefined })
      .resolves({
        Parameters: [{ Name: '/s10-marketing/dev/app-url', Value: 'https://dev.example.com' }],
        NextToken: 'p2',
      })
      .on(GetParametersByPathCommand, { Path: '/s10-marketing/dev/', NextToken: 'p2' })
      .resolves({
        Parameters: [
          { Name: '/s10-marketing/dev/publishing-enabled', Value: 'true' },
          { Name: '/s10-marketing/dev/log-level', Value: 'debug' },
        ],
      });

    const cfg = await loadConfig({
      env: { APP_ENV: 'dev', LOG_LEVEL: 'warn' },
      ssm: new SSMClient({ region: 'us-east-1' }),
    });
    expect(cfg.APP_URL).toBe('https://dev.example.com');
    expect(cfg.PUBLISHING_ENABLED).toBe(true);
    expect(cfg.LOG_LEVEL).toBe('warn');
    expect(ssmMock.calls()).toHaveLength(2);
  });
});

describe('publicConfig', () => {
  it('exposes only browser-safe values', () => {
    const cfg = parseConfig({ APP_ENV: 'local', DB_SECRET_ARN: 'arn:secret', TOKEN_KMS_KEY_ARN: 'arn:kms' });
    expect(Object.keys(publicConfig(cfg)).sort()).toEqual(
      ['appEnv', 'appUrl', 'cognitoClientId', 'cognitoDomain'].sort(),
    );
  });
});
