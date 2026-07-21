import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUII18n, setLang, t } from '../web/js/i18n.js';

test('i18n resolves content IDs, legacy English aliases and English fallbacks', async () => {
  const originalFetch = globalThis.fetch;
  const en = {
    'toy.puzzle.first.title': 'First puzzle',
    'toy.puzzle.first.brief': 'Find the winning move.',
  };
  const kn = {
    'Legacy button': 'ಹಳೆಯ ಗುಂಡಿ',
    'toy.puzzle.first.title': 'ಮೊದಲ ಒಗಟು',
    'toy.puzzle.first.brief': 'ಗೆಲುವಿನ ನಡೆಯನ್ನು ಹುಡುಕಿ.',
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).endsWith('/en.json') ? en : kn,
  });
  try {
    setLang('kn');
    await loadUII18n('toy');
    assert.equal(t('toy.puzzle.first.title'), 'ಮೊದಲ ಒಗಟು');
    assert.equal(t('First puzzle'), 'ಮೊದಲ ಒಗಟು');
    assert.equal(t('Legacy button'), 'ಹಳೆಯ ಗುಂಡಿ');

    setLang('en');
    await loadUII18n('toy');
    assert.equal(t('toy.puzzle.first.brief'), 'Find the winning move.');
  } finally {
    globalThis.fetch = originalFetch;
    setLang('en');
  }
});
