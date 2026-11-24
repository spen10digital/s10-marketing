import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { AppError } from '../errors/app-error';

/**
 * SSRF-safe HTTP GET for user-supplied URLs (02 §8). The address check runs inside the socket's
 * own DNS lookup, so the address that is checked is the address that is connected to (no DNS
 * rebinding window). Every redirect is re-validated the same way.
 */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Content types accepted for the final response. */
  accept?: RegExp;
  userAgent?: string;
  /** Resolver, injectable for tests. Defaults to the system resolver. */
  lookup?: typeof dnsLookup;
  /** Which addresses may be connected to. Defaults to public addresses only. */
  isAllowedAddress?: (address: string) => boolean;
  /** Ports that may be used. Defaults to 80/443 (the standard ports). */
  allowedPorts?: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  accept: /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i,
  userAgent: 'S10MarketingBot/1.0 (+https://spen10.com)',
};

export const ALLOWED_PORTS: ReadonlySet<string> = new Set(['', '80', '443']);

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True for addresses on the public internet; private, loopback, link-local, etc. are refused. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(address, 'ipv6');
  }
  return false;
}

/** Validates a URL before any network activity. */
export function checkUrl(raw: string, allowedPorts: ReadonlySet<string> = ALLOWED_PORTS): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('BAD_REQUEST', 'That isn’t a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('BAD_REQUEST', 'Only http and https addresses can be read.');
  }
  if (url.username || url.password)
    throw new AppError('BAD_REQUEST', 'Addresses with passwords can’t be read.');
  if (!allowedPorts.has(url.port)) throw new AppError('BAD_REQUEST', 'Only standard web ports can be read.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw blockedAddressError();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    (!host.includes('.') && !isIP(host))
  ) {
    throw blockedAddressError();
  }
  return url;
}

const blockedAddressError = () =>
  new AppError('BAD_REQUEST', 'That address points to a private network and can’t be read.');

function guardedLookup(resolve: typeof dnsLookup, allowed: (a: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = (Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }]) as {
        address: string;
        family: number;
      }[];
      // Refuse if *any* resolved address is private, so a mixed answer can't be raced.
      if (list.length === 0 || list.some((a) => !allowed(a.address))) {
        return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), '', 0);
      }
      if ((options as { all?: boolean }).all)
        return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
      const first = list[0]!;
      callback(null, first.address, first.family);
    });
  };
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...SAFE_FETCH_DEFAULTS, ...options };
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  const lookup = guardedLookup(options.lookup ?? dnsLookup, allowed);
  const deadline = Date.now() + opts.timeoutMs;

  const ports = options.allowedPorts ?? ALLOWED_PORTS;
  let url = checkUrl(rawUrl, ports);
  for (let redirects = 0; ; redirects += 1) {
    const response = await requestOnce(url, { ...opts, lookup, deadline, allowed });
    if (response.redirect) {
      if (redirects >= opts.maxRedirects)
        throw new AppError('BAD_REQUEST', 'That address redirects too many times.');
      url = checkUrl(new URL(response.redirect, url).toString(), ports);
      continue;
    }
    return {
      url: url.toString(),
      status: response.status,
      contentType: response.contentType,
      body: response.body,
    };
  }
}

interface OnceOptions {
  maxBytes: number;
  accept: RegExp;
  userAgent: string;
  lookup: LookupFunction;
  deadline: number;
  allowed: (a: string) => boolean;
  signal?: AbortSignal;
}

function requestOnce(
  url: URL,
  opts: OnceOptions,
): Promise<{ status: number; contentType: string; body: string; redirect?: string }> {
  return new Promise((resolve, reject) => {
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) return reject(timeoutError());
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !opts.allowed(host)) return reject(blockedAddressError());

    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      {
        lookup: opts.lookup,
        headers: { 'user-agent': opts.userAgent, accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
        signal: opts.signal,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, contentType: '', body: '', redirect: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new AppError('BAD_REQUEST', `The website answered with an error (HTTP ${status}).`));
        }
        const contentType = String(res.headers['content-type'] ?? '');
        if (!opts.accept.test(contentType)) {
          res.resume();
          return reject(new AppError('BAD_REQUEST', 'That address isn’t a web page.'));
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return reject(tooLargeError());
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            reject(tooLargeError());
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status, contentType, body: decode(Buffer.concat(chunks), contentType) }),
        );
        res.on('error', (err) => reject(networkError(err)));
      },
    );
    req.setTimeout(remaining, () => req.destroy(timeoutError()));
    req.on('error', (err) => reject(err instanceof AppError ? err : networkError(err)));
  });
}

function decode(buffer: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

const timeoutError = () => new AppError('BAD_REQUEST', 'The website took too long to answer.');
const tooLargeError = () => new AppError('BAD_REQUEST', 'That page is too large to read.');

function networkError(err: unknown): AppError {
  if ((err as { code?: string })?.code === 'EBLOCKED') return blockedAddressError();
  if (err instanceof AppError) return err;
  return new AppError('BAD_REQUEST', 'The website couldn’t be reached.', { cause: err });
}

// ---------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------

/** Rules for our user agent (or `*`), longest match wins, Allow beats Disallow on ties. */
export function robotsAllows(robotsTxt: string, path: string, agent = 'S10MarketingBot'): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (value !== '') current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!robotsMatch(rule.path, path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow))
      best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

/** Fetches robots.txt for the URL's origin; a missing or unreadable file allows everything. */
export async function isAllowedByRobots(url: URL, options: SafeFetchOptions = {}): Promise<boolean> {
  try {
    const robots = await safeFetch(new URL('/robots.txt', url).toString(), {
      ...options,
      maxBytes: 512 * 1024,
      accept: /^text\/plain\b/i,
      maxRedirects: 1,
    });
    return robotsAllows(robots.body, url.pathname + url.search);
  } catch {
    return true;
  }
}
