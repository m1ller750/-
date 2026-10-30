// Cover colours and short labels for popular games; anything else gets colours from its name.
export const GAMES = [
  ['Counter-Strike 2', 'CS2', '#f59e0b', '#ef4444'],
  ['Dota 2', 'DOTA', '#ef4444', '#7c3aed'],
  ['Valorant', 'VAL', '#fb7185', '#9333ea'],
  ['League of Legends', 'LoL', '#06b6d4', '#3b82f6'],
  ['PUBG Mobile', 'PUBG', '#f59e0b', '#65a30d'],
  ['Mobile Legends', 'MLBB', '#3b82f6', '#8b5cf6'],
  ['Standoff 2', 'SO2', '#f97316', '#eab308'],
  ['EA FC', 'FC', '#22c55e', '#0891b2'],
  ['Fortnite', 'FN', '#a855f7', '#ec4899'],
  ['Clash Royale', 'CR', '#0ea5e9', '#facc15'],
  ['Chess', 'CHESS', '#64748b', '#a78bfa'],
  ['Football', 'FOOT', '#16a34a', '#22d3ee'],
];

export const GAME_NAMES = GAMES.map(([name]) => name);
const INDEX = new Map(GAMES.map(([name, abbr, c1, c2]) => [name.toLowerCase(), { abbr, c1, c2 }]));

export function hueOf(text) {
  let hash = 5381;
  for (const ch of String(text ?? '')) hash = ((hash * 33) ^ ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

export function gameStyle(name) {
  const known = INDEX.get(String(name ?? '').trim().toLowerCase());
  if (known) return known;
  const h = hueOf(name);
  const words = String(name ?? '').split(/[\s\-_:]+/).filter(Boolean);
  return {
    abbr: words.slice(0, 3).map((w) => w[0]).join('').toUpperCase() || '?',
    c1: `hsl(${h} 85% 60%)`,
    c2: `hsl(${(h + 50) % 360} 80% 45%)`,
  };
}

export function initials(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
