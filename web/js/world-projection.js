import { worldCatalogText, worldPaletteColor } from './world-format.js';

const TEACHING_ROLES = ['start', 'mill', 'remove', 'win', 'lose'];

export function projectSmaWorldV2({ manifest, catalogs: { en, kn } }) {
  const prefix = `${manifest.game}.${manifest.id}`;
  const banks = { start: [], mill: [], remove: [], win: [], lose: [] };
  for (const contentId of manifest.content.teachingIds) {
    const role = TEACHING_ROLES.find((slug) => contentId.startsWith(`${prefix}.teaching.${slug}-`));
    if (!role) throw new TypeError(`SMA projector: teaching id has no renderer role (${contentId})`);
    banks[role].push({ text: worldCatalogText(en, contentId) });
  }
  for (const [role, items] of Object.entries(banks)) {
    if (!items.length) throw new TypeError(`SMA projector: catalog missing ${role}`);
  }

  const render = manifest.render;
  const bg = worldPaletteColor(render, 'background', '#08090b');
  return {
    schema: 2,
    game: manifest.game,
    id: manifest.id,
    title: worldCatalogText(en, manifest.titleKey, 'title'),
    kannada: worldCatalogText(kn, manifest.kannadaTitleKey, 'Kannada title'),
    subtitle: worldCatalogText(en, manifest.content.aboutSummaryKey, 'about summary'),
    intent: worldCatalogText(en, `${prefix}.intent`, 'intent'),
    era: 'original',
    realistic: manifest.realistic,
    theme: {
      bg,
      board: worldPaletteColor(render, 'board', '#1a1b1f'),
      node: worldPaletteColor(render, 'node', '#dfe4ea'),
      p0: worldPaletteColor(render, 'piece-0', '#e8edf2'),
      p1: worldPaletteColor(render, 'piece-1', '#b98a4e'),
      accent: worldPaletteColor(render, 'accent', '#cbd3db'),
      text: worldPaletteColor(render, 'text', '#eef2f6'),
      fog: bg,
    },
    sides: {
      p0: { name: worldCatalogText(en, `${prefix}.side.p0`, 'side.p0'), en: 'Player one pieces' },
      p1: { name: worldCatalogText(en, `${prefix}.side.p1`, 'side.p1'), en: 'Player two pieces' },
    },
    voice: { web: 'en-IN', azure: null },
    teachings: banks,
    render: JSON.parse(JSON.stringify(render)),
    audio: JSON.parse(JSON.stringify(manifest.audio)),
    content: JSON.parse(JSON.stringify(manifest.content)),
    rulesetCompatibility: JSON.parse(JSON.stringify(manifest.rulesetCompatibility)),
  };
}
