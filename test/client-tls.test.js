import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { SynologyClient } from '../src/synology/client.js';

// These tests run the client's DEFAULT fetch against a real HTTPS server with a self-signed
// certificate: 2.2.0 shipped a fetch/dispatcher pair from two different undici versions, which every
// stubbed `fetchImpl` hid, and every NAS with a self-signed certificate went offline.

function generateSelfSignedCertificate() {
  const directory = mkdtempSync(join(tmpdir(), 'gladys-synology-tls-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(directory, 'key.pem')),
      cert: readFileSync(join(directory, 'cert.pem')),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

let tls = null;
try {
  tls = generateSelfSignedCertificate();
} catch {
  // No openssl binary: the tests below are skipped rather than failing for the wrong reason.
}

const skip = tls ? false : 'openssl is not available';
const requests = [];
let server;
let url;

before(async () => {
  if (!tls) return;
  server = createServer(tls, (request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push(Object.fromEntries(new URLSearchParams(body)));
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          data: { 'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 } },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `https://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections();
  server?.close();
});

function clientFor(settings) {
  return new SynologyClient(
    normalizeConfig({ url, username: 'gladys', password: 'password', ...settings }),
    { requestTimeoutMs: 5_000 },
  );
}

const fingerprint = () => new X509Certificate(tls.cert).fingerprint256;

test('a self-signed DSM is reached when the certificate check is disabled', { skip }, async () => {
  const client = clientFor({ verify_ssl: false });
  try {
    const apis = await client.discoverApis();
    assert.equal(apis['SYNO.API.Auth'].path, 'auth.cgi');
  } finally {
    await client.close();
  }
});

test('a self-signed DSM is refused while the certificate is verified', { skip }, async () => {
  const client = clientFor({ verify_ssl: true });
  try {
    await assert.rejects(client.discoverApis(), /certificate rejected \(DEPTH_ZERO_SELF_SIGNED/);
  } finally {
    await client.close();
  }
});

test('a pinned fingerprint accepts exactly that self-signed certificate', { skip }, async () => {
  // Pasted the way a browser shows it; the check stays on, the pin replaces it.
  const client = clientFor({ verify_ssl: true, cert_fingerprint: fingerprint() });
  try {
    const apis = await client.discoverApis();
    assert.equal(apis['SYNO.API.Auth'].path, 'auth.cgi');
  } finally {
    await client.close();
  }
});

test(
  'a certificate that does not match the pin is refused before any request',
  { skip },
  async () => {
    const wrong = fingerprint().replace(/^[0-9A-F]/, (digit) => (digit === '0' ? '1' : '0'));
    const client = clientFor({ verify_ssl: false, cert_fingerprint: wrong });
    const before = requests.length;
    try {
      await assert.rejects(client.login(), /does not match the pinned SHA-256 fingerprint/);
      assert.equal(
        requests.length,
        before,
        'nothing, the password least of all, reached the server',
      );
    } finally {
      await client.close();
    }
  },
);
