import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { htmlToText } from './html';
import { checkUrl, isPublicAddress, robotsAllows, safeFetch, type SafeFetchOptions } from './safe-fetch';
import { pickPages, readWebsite } from './website';

/**
 * The test server listens on 127.0.0.1. Hostnames are resolved by a fake resolver; only the
 * address `127.0.0.1` is "allowed" here, standing in for a public address. Everything else uses
 * the real policy (`isPublicAddress`) or a fake resolver answer in a private range.
 */
const DNS: Record<string, string[]> = {
  'site.test': ['127.0.0.1'],
  'other.test': ['127.0.0.1'],
  'internal.test': ['10.0.0.5'],
  'metadata.test': ['169.254.169.254'],
  'mixed.test': ['127.0.0.1', '192.168.1.1'],
  'mapped.test': ['::ffff:10.0.0.1'],
};

let port = 0;
let server: http.Server;

const fakeLookup = ((
  hostname: string,
  _options: unknown,
  callback: (e: Error | null, a: LookupAddress[]) => void,
) => {
  const addresses = DNS[hostname];
  if (!addresses) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  callback(
    null,
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
}) as unknown as SafeFetchOptions['lookup'];

const opts = (extra: SafeFetchOptions = {}): SafeFetchOptions => ({
  lookup: fakeLookup,
  isAllowedAddress: (a) => a === '127.0.0.1' || isPublicAddress(a),
  // Production only allows 80/443; the local test server listens on a random port.
  allowedPorts: new Set([String(port)]),
  ...extra,
});
const url = (host: string, path = '/') => `http://${host}${path}`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const host = req.headers.host ?? '';
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /private\n');
    }
    if (path === '/redirect-private') {
      res.writeHead(302, { location: `http://internal.test:${port}/` });
      return res.end();
    }
    if (path === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' });
      return res.end();
    }
    if (path === '/redirect-ok') {
      res.writeHead(301, { location: '/about' });
      return res.end();
    }
    if (path === '/huge') {
      res.writeHead(200, { 'content-type': 'text/html' });
      const chunk = 'x'.repeat(64 * 1024);
      for (let i = 0; i < 40; i += 1) res.write(chunk);
      return res.end();
    }
    if (path === '/slow') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<p>start');
      return; // never ends
    }
    if (path === '/image') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end('png');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<html><head><title>Loot &amp; Goblins</title><meta name="description" content="Dice stuff"><script>alert(1)</script></head>
       <body><nav>menu</nav><h1>Welcome ${host}${path}</h1><p>We make dice&nbsp;towers.</p>
       <a href="/about">About us</a><a href="/blog/post-1">Post</a><a href="/private/x">Secret</a>
       <a href="https://elsewhere.example/">Away</a><a href="/logo.png">Logo</a></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections(); // the /slow response never ends on its own
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('address policy', () => {
  it('blocks private, loopback, link-local, metadata and mapped addresses', () => {
    for (const a of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.0.1',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
    ]) {
      expect([a, isPublicAddress(a)]).toEqual([a, false]);
    }
    for (const a of ['93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8'])
      expect([a, isPublicAddress(a)]).toEqual([a, true]);
  });

  it('rejects bad URLs before any network activity', () => {
    for (const bad of [
      'ftp://site.test/',
      'file:///etc/passwd',
      'http://user:pw@site.test/',
      'http://localhost/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://intranet/',
      'http://site.test:22/',
      'not a url',
    ]) {
      expect(() => checkUrl(bad)).toThrow();
    }
  });
});

describe('safeFetch', () => {
  it('fetches a public page', async () => {
    const res = await safeFetch(url(`site.test:${port}`, '/'), opts());
    expect(res.status).toBe(200);
    expect(res.body).toContain('Welcome');
  });

  it('refuses hosts that resolve to private addresses, including mixed answers', async () => {
    for (const host of ['internal.test', 'metadata.test', 'mixed.test', 'mapped.test']) {
      await expect(safeFetch(url(`${host}:${port}`), opts())).rejects.toMatchObject({
        message: expect.stringMatching(/private network/),
      });
    }
  });

  it('refuses redirects into private ranges and too many redirects, and follows good ones', async () => {
    await expect(safeFetch(url(`site.test:${port}`, '/redirect-private'), opts())).rejects.toMatchObject({
      message: expect.stringMatching(/private network/),
    });
    await expect(safeFetch(url(`site.test:${port}`, '/redirect-loop'), opts())).rejects.toMatchObject({
      message: expect.stringMatching(/too many/),
    });
    const ok = await safeFetch(url(`site.test:${port}`, '/redirect-ok'), opts());
    expect(ok.url).toBe(url(`site.test:${port}`, '/about'));
  });

  it('caps size and time, and only accepts web pages', async () => {
    await expect(safeFetch(url(`site.test:${port}`, '/huge'), opts())).rejects.toMatchObject({
      message: expect.stringMatching(/too large/),
    });
    await expect(
      safeFetch(url(`site.test:${port}`, '/slow'), opts({ timeoutMs: 300 })),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/too long/),
    });
    await expect(safeFetch(url(`site.test:${port}`, '/image'), opts())).rejects.toMatchObject({
      message: expect.stringMatching(/isn’t a web page/),
    });
  });

  it('with the default policy, even the local test server is unreachable', async () => {
    await expect(
      safeFetch(url(`site.test:${port}`), { ...opts(), isAllowedAddress: undefined }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/private network/),
    });
  });
});

describe('robots.txt', () => {
  it('applies the most specific matching rule for our agent or *', () => {
    const robots = 'User-agent: *\nDisallow: /\nAllow: /blog\n\nUser-agent: OtherBot\nDisallow:\n';
    expect(robotsAllows(robots, '/about')).toBe(false);
    expect(robotsAllows(robots, '/blog/post')).toBe(true);
    expect(robotsAllows('User-agent: S10MarketingBot\nDisallow: /x$\n', '/x')).toBe(false);
    expect(robotsAllows('User-agent: S10MarketingBot\nDisallow: /x$\n', '/xy')).toBe(true);
    expect(robotsAllows('', '/anything')).toBe(true);
  });
});

describe('website reader', () => {
  it('turns HTML into text without scripts or navigation', () => {
    const page = htmlToText(
      '<title>A &amp; B</title><script>evil()</script><nav>menu</nav><p>Hello&nbsp;there</p>',
    );
    expect(page.title).toBe('A & B');
    expect(page.text).toBe('Hello there');
  });

  it('picks same-site About/blog pages first and skips files and other sites', () => {
    const home = new URL('https://site.test/');
    const picked = pickPages(home, [
      '/contact',
      '/about',
      'https://elsewhere.example/about',
      '/logo.png',
      '/blog/x',
      '/',
      '#top',
      '/about/',
    ]);
    expect(picked.map((u) => u.pathname)).toEqual(['/about', '/blog/x', '/contact']);
  });

  it('reads the home page plus up to 4 pages, honouring robots.txt', async () => {
    const pages = await readWebsite(url(`site.test:${port}`), opts());
    expect(pages[0]?.title).toBe('Loot & Goblins');
    expect(pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/about', '/blog/post-1']);
    expect(pages.every((p) => !p.text.includes('alert('))).toBe(true);
  });
});
