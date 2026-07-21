import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aliasEnglish,
  assertContentId,
  assertNoEnglishKeys,
  cid,
  englishFor,
  isContentId,
  resolveText,
} from '../web/js/content-id.js';

test('stable content ids validate and raw English is rejected in strict mode', () => {
  assert.equal(isContentId('ah.tut.enter'), true);
  assert.equal(isContentId('How to play'), false);
  assert.equal(assertContentId('shared.action.skip'), 'shared.action.skip');
  assert.throws(() => assertContentId('Skip'), /content id/);
  assert.throws(() => cid('Unknown English', { strict: true }), /Unregistered/);
});

test('English aliases bridge old source strings to stable ids', () => {
  aliasEnglish({ 'Enter the board.': 'toy.tut.enter' });
  assert.equal(cid('Enter the board.'), 'toy.tut.enter');
  assert.equal(englishFor('toy.tut.enter'), 'Enter the board.');
  assert.equal(resolveText('Enter the board.', (key) => ({ 'toy.tut.enter': 'ಮಂಡಳಿಗೆ ಬನ್ನಿ.' })[key] ?? key), 'ಮಂಡಳಿಗೆ ಬನ್ನಿ.');
  assert.equal(resolveText('toy.tut.enter', (key) => key), 'Enter the board.');
});

test('ambiguous aliases are refused', () => {
  aliasEnglish({ 'One source.': 'toy.copy.one' });
  assert.throws(() => aliasEnglish({ 'One source.': 'toy.copy.two' }), /Ambiguous/);
  assert.throws(() => aliasEnglish({ 'Other source.': 'toy.copy.one' }), /Ambiguous/);
});

test('factory guard checks content-bearing fields without confusing other data strings', () => {
  const scenario = {
    id: 'toy-opening',
    seed: 'English-looking seed',
    titleKey: 'toy.puzzle.opening-title',
    briefKey: 'toy.puzzle.opening-brief',
    hintKeys: ['toy.puzzle.opening-hint'],
  };
  assert.equal(assertNoEnglishKeys(scenario), true);
  assert.throws(() => assertNoEnglishKeys({ ...scenario, titleKey: 'Opening move' }), /content id/);
});
