import path from 'node:path';
import { POINTS, MILLS, PIECES } from '../web/js/logic.js';

const RULESET = Object.freeze({ id: 'sma.base', version: 1 });

const exact = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new TypeError(`${label} has unknown field ${key}`);
  for (const key of fields) if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
};

export async function validateFactorySemantic({ root, game, worldId, compatibility, fixture }) {
  if (game !== 'sma' || RULESET.id !== compatibility.ruleset.id || RULESET.version !== compatibility.ruleset.version) {
    throw new TypeError('SMA renderer compatibility does not match the registered ruleset');
  }
  exact(fixture, ['schema', 'game', 'worldId', 'ruleset', 'board'], 'SMA semantic fixture');
  exact(fixture.ruleset, ['id', 'version'], 'SMA semantic ruleset');
  exact(fixture.board, ['kind', 'points', 'mills', 'piecesPerSide'], 'SMA semantic board');
  const actual = {
    kind: 'mill-board',
    points: POINTS.length,
    mills: MILLS.length,
    piecesPerSide: PIECES,
  };
  if (fixture.schema !== 1 || fixture.game !== game || fixture.worldId !== worldId
    || fixture.ruleset.id !== RULESET.id || fixture.ruleset.version !== RULESET.version
    || JSON.stringify(fixture.board) !== JSON.stringify(actual)) {
    throw new TypeError('SMA semantic fixture does not match the base engine ruleset');
  }
  return {
    ruleset: { ...RULESET },
    rendererContentIds: [
      `${game}.${worldId}.intent`,
      `${game}.${worldId}.side.p0`,
      `${game}.${worldId}.side.p1`,
    ],
    toolFiles: [
      { name: 'rules-engine', version: String(RULESET.version), path: path.join(root, 'SaaluManeAta', 'web', 'js', 'logic.js') },
      { name: 'ruleset-validator', version: String(RULESET.version), path: path.join(root, 'SaaluManeAta', 'web', 'js', 'ruleset.js') },
    ],
  };
}
