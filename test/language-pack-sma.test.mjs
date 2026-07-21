// v1.8 α1 — guards the SMA optional-language text packs (hi/ta/te/ml/mr) through the shared language-pack
// validators + the bundled web schema: trusted index, manifest hash-addressing, canonical payload
// identity, and byte-for-byte fidelity to the repackaged source catalogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  validateLanguageIndex, validateLanguageManifest, validateLanguagePackSchema, hashLanguageManifest, voiceContentId,
} from '../web/js/language-pack.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const rawSha = (b) => createHash('sha256').update(b).digest('hex');
const readBytes = (rel) => readFile(`${WEB}${rel}`);
const readJson = async (rel) => JSON.parse((await readBytes(rel)).toString('utf8'));

const OPTIONAL = ['hi', 'ta', 'te', 'ml', 'mr'];

test('SMA trusted language index validates and keeps kn/en core', async () => {
  const index = await readJson('packs/sma/language-index.json');
  assert.equal(validateLanguageIndex(index, { game: 'sma' }), true);
  assert.deepEqual(index.coreLanguages, ['kn', 'en']);
  assert.equal(index.defaultLanguage, 'en');
  for (const lang of OPTIONAL) {
    assert.ok(index.packs.some((p) => p.language === lang && p.component === 'text'), `${lang} text pack present`);
  }
});

for (const lang of OPTIONAL) {
  test(`SMA ${lang} text manifest is hash-addressed, schema-valid, and cross-file consistent`, async () => {
    const index = await readJson('packs/sma/language-index.json');
    const entry = index.packs.find((p) => p.language === lang && p.component === 'text');
    const manifestBytes = await readBytes(entry.manifestPath);
    assert.equal(rawSha(manifestBytes), entry.manifestSha256);
    assert.equal(manifestBytes.byteLength, entry.manifestBytes);

    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const schema = await readJson('schemas/v1.8/language-pack.schema.json');
    assert.equal(validateLanguagePackSchema(schema, manifest), true);
    assert.equal(validateLanguageManifest(manifest, { game: 'sma', entry }), true);

    const payloadHash = await hashLanguageManifest(manifest);
    assert.equal(payloadHash, manifest.sha256);
    assert.equal(payloadHash, entry.packSha256);

    let sum = 0;
    for (const file of manifest.files) {
      const bytes = await readBytes(file.path);
      sum += bytes.byteLength;
      assert.equal(bytes.byteLength, file.bytes, `${file.path} byte count`);
      assert.equal(rawSha(bytes), file.sha256, `${file.path} sha256`);
    }
    assert.equal(sum, manifest.bytes);
    assert.equal(sum, entry.packBytes);
  });

  test(`SMA ${lang} pack repackages the existing catalogs byte-for-byte`, async () => {
    const index = await readJson('packs/sma/language-index.json');
    const entry = index.packs.find((p) => p.language === lang && p.component === 'text');
    const manifest = await readJson(entry.manifestPath);
    assert.equal(rawSha(await readBytes(`packs/sma/${lang}/1/ui.json`)), rawSha(await readBytes(`assets/ui/${lang}.json`)));
    for (const file of manifest.files.filter((f) => f.role === 'world')) {
      const world = file.path.match(/world-([a-z0-9-]+)\.json$/)[1];
      assert.equal(
        rawSha(await readBytes(file.path)),
        rawSha(await readBytes(`assets/${world}/i18n/${lang}.json`)),
        `${world} catalog`,
      );
    }
  });
}

const VOICE_SCOPES = ['angadi', 'navagraha', 'parampare', 'saalu', 'ui'];
test('SMA index lists a voice pack per optional language', async () => {
  const index = await readJson('packs/sma/language-index.json');
  for (const lang of OPTIONAL) {
    assert.ok(index.packs.some((p) => p.language === lang && p.component === 'voice'), `${lang} voice pack present`);
  }
});

for (const lang of OPTIONAL) {
  test(`SMA ${lang} voice manifest is hash-addressed, schema-valid, and 1:1 with its voice files`, async () => {
    const index = await readJson('packs/sma/language-index.json');
    const entry = index.packs.find((p) => p.language === lang && p.component === 'voice');
    const manifestBytes = await readBytes(entry.manifestPath);
    assert.equal(rawSha(manifestBytes), entry.manifestSha256);
    assert.equal(manifestBytes.byteLength, entry.manifestBytes);

    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const schema = await readJson('schemas/v1.8/language-pack.schema.json');
    assert.equal(validateLanguagePackSchema(schema, manifest), true);
    assert.equal(validateLanguageManifest(manifest, { game: 'sma', entry }), true);
    assert.equal(manifest.component, 'voice');
    assert.equal(manifest.fallbackLanguage, null);

    const payloadHash = await hashLanguageManifest(manifest);
    assert.equal(payloadHash, manifest.sha256);
    assert.equal(payloadHash, entry.packSha256);

    let sum = 0;
    for (const file of manifest.files) {
      const bytes = await readBytes(file.path);
      sum += bytes.byteLength;
      assert.equal(bytes.byteLength, file.bytes, `${file.path} byte count`);
      assert.equal(rawSha(bytes), file.sha256, `${file.path} sha256`);
    }
    assert.equal(sum, manifest.bytes);
    assert.equal(sum, entry.packBytes);

    const vmFile = manifest.files.find((f) => f.role === 'voice-manifest');
    const vmap = JSON.parse((await readBytes(vmFile.path)).toString('utf8'));
    const voices = manifest.files.filter((f) => f.role === 'voice');
    assert.equal(Object.keys(vmap).length, voices.length);
    for (const v of voices) assert.equal(vmap[v.contentId], v.path, `voice-manifest maps ${v.contentId}`);
  });

  test(`SMA ${lang} voice content ids are scoped and derivable from source voice.json`, async () => {
    const index = await readJson('packs/sma/language-index.json');
    const entry = index.packs.find((p) => p.language === lang && p.component === 'voice');
    const manifest = JSON.parse((await readBytes(entry.manifestPath)).toString('utf8'));
    const vmap = JSON.parse((await readBytes(manifest.files.find((f) => f.role === 'voice-manifest').path)).toString('utf8'));
    for (const scope of VOICE_SCOPES) {
      let src;
      try { src = await readJson(`assets/${scope}/voice/${lang}/voice.json`); } catch { continue; }
      for (const text of Object.keys(src)) {
        const cid = await voiceContentId(scope, text, { cryptoImpl: globalThis.crypto });
        assert.ok(cid in vmap, `${scope} clip content id present in voice-manifest`);
      }
    }
  });
}
