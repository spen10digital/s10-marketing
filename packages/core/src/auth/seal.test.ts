import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error';
import { decodeSessionSecret, readSession, seal, sessionPayload, unseal } from './seal';

const key = () => new Uint8Array(randomBytes(32));
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

describe('sealed cookies', () => {
  it('round-trips a payload', async () => {
    const k = key();
    const value = await seal({ sub: 'u1', rt: 'refresh-token' }, k, 60, NOW);
    expect(value).not.toContain('refresh-token'); // encrypted, not just signed
    const payload = await unseal(value, k, NOW + 1000);
    expect(payload).toMatchObject({ sub: 'u1', rt: 'refresh-token' });
  });

  it('rejects a missing, tampered, expired or wrong-key value', async () => {
    const k = key();
    const value = await seal({ sub: 'u1' }, k, 60, NOW);
    expect(await unseal(undefined, k, NOW)).toBeNull();
    expect(await unseal('', k, NOW)).toBeNull();
    expect(await unseal(`${value.slice(0, -2)}xx`, k, NOW)).toBeNull();
    expect(await unseal(value, key(), NOW)).toBeNull();
    expect(await unseal(value, k, NOW + 61_000)).toBeNull();
  });
});

describe('decodeSessionSecret', () => {
  it('accepts 32 bytes of base64url and refuses everything else without echoing it', () => {
    const good = randomBytes(32).toString('base64url');
    expect(decodeSessionSecret(`${good}\r\n`)).toHaveLength(32);
    for (const bad of [undefined, '', '   ', 'short', randomBytes(16).toString('base64url')]) {
      const err = (() => {
        try {
          decodeSessionSecret(bad);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('CONFIG_INVALID');
      if (bad && bad.length > 4) expect((err as AppError).message).not.toContain(bad);
    }
  });
});

describe('readSession', () => {
  const tokens = { sub: 'u1', email: 'a@b.test', accessToken: 'at', expiresIn: 3600 };

  it('returns the session while the access token is valid', () => {
    const s = readSession(sessionPayload(tokens, NOW), NOW + 1000);
    expect(s).toMatchObject({ sub: 'u1', email: 'a@b.test', accessToken: 'at' });
  });

  it('returns null when expired or incomplete', () => {
    expect(readSession(sessionPayload(tokens, NOW), NOW + 3_600_000)).toBeNull();
    expect(readSession(null)).toBeNull();
    expect(readSession({ sub: 'u1' })).toBeNull();
    expect(readSession({ at: 'x', atExp: 9e12 })).toBeNull();
  });
});
