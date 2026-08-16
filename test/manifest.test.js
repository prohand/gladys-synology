import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_CONFIG, MAX_POLL_FREQUENCY, MIN_POLL_FREQUENCY } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('manifest identifies a versioned Synology device integration', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Synology DSM');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-synology:${manifest.version}`);
});

test('manifest configuration defaults stay in sync with code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field]));
  assert.equal(fields.verify_ssl.default, DEFAULT_CONFIG.verify_ssl);
  assert.equal(Number(fields.poll_frequency.default), DEFAULT_CONFIG.poll_frequency);
  assert.equal(fields.poll_frequency.type, 'number');
  assert.equal(fields.poll_frequency.min, MIN_POLL_FREQUENCY);
  assert.equal(fields.poll_frequency.max, MAX_POLL_FREQUENCY);
  assert.equal(fields.poll_frequency.options, undefined);
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.otp_code.type, 'secret');
  assert.equal(fields.additional_nas, undefined);
  for (const slot of [2, 3, 4]) {
    assert.equal(fields[`nas_${slot}_password`].type, 'secret');
    assert.equal(fields[`nas_${slot}_otp_code`].type, 'secret');
    assert.equal(fields[`nas_${slot}_url`].required, false);
    assert.equal(fields[`nas_${slot}_verify_ssl`].default, true);
  }
  assert.equal(fields.otp_code.required, false);
  for (const key of ['url', 'username', 'password']) assert.equal(fields[key].required, true);
});

test('manifest exposes local transport, documentation and connection test', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.config_schema.find((field) => field.type === 'section').links.length > 0);
  assert.ok(manifest.actions.some((action) => action.key === 'test_connection'));
});

test('catalog assets satisfy the store size and dimension constraints', async () => {
  const coverPath = new URL('../cover.png', import.meta.url);
  const cover = await readFile(coverPath);
  assert.equal(cover.toString('ascii', 1, 4), 'PNG');
  assert.equal(cover.readUInt32BE(16), 800);
  assert.equal(cover.readUInt32BE(20), 534);
  assert.ok((await stat(coverPath)).size <= 150_000);

  for (const language of ['en', 'fr']) {
    const documentation = await readFile(
      new URL(`../docs/${language}.md`, import.meta.url),
      'utf8',
    );
    assert.ok(documentation.length >= 300, `${language} documentation is too short`);
  }
});
