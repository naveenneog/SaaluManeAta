// Lobby/session config for Saalu Mane Ata. Written to sessionStorage 'sma.game'.
export const WORLDS = [
  { id: 'parampare', title: 'Parampare', kannada: 'ಪರಂಪರೆ',   tag: 'Heritage — carved teak & real seeds', era: 'realistic', accent: '#c89b4a', p0: '#9a6a34', p1: '#e8ddc4', bg: '#14100a' },
  { id: 'saalu',     title: 'Saalu Mane', kannada: 'ಸಾಲು ಮನೆ', tag: 'Rows of houses — glowing 3D', era: 'original', accent: '#e8b24a', p0: '#e6693a', p1: '#e9dcc0', bg: '#120c06' },
  { id: 'angadi',    title: 'Angadi',     kannada: 'ಅಂಗಡಿ',    tag: 'The marketplace — a modern reading', era: 'modern', accent: '#4bc2d6', p0: '#e5484d', p1: '#e8b64a', bg: '#0a1014' },
  { id: 'navagraha', title: 'Navagraha',  kannada: 'ನವಗ್ರಹ',   tag: 'The nine grahas — a cosmic reading', era: 'fable', accent: '#7cf0ff', p0: '#ffcf5a', p1: '#8b5cf6', bg: '#0a0a18' },
];
export const worldById = (id) => WORLDS.find((w) => w.id === id) || WORLDS[0];
export function saveGame(c) { try { sessionStorage.setItem('sma.game', JSON.stringify(c)); } catch { /* */ } }
export function loadGame() { try { return JSON.parse(sessionStorage.getItem('sma.game') || '{}'); } catch { return {}; } }
