import * as cheerio from 'cheerio';
const SERVER_LIST_URL = process.env.SERVER_LIST_URL || 'http://www.mnbcentral.net/';
const FETCH_TIMEOUT_MS = 20000;
async function fetchServerListHtml() {
  const res = await fetch(SERVER_LIST_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MelodiaServerMonitor/2.0)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching server list`);
  return res.text();
}
export function parseServers(html) {
  const $ = cheerio.load(html);
  const servers = [];
  $('tr').each((_, row) => {
    const values = $(row).find('td').map((__, td) => $(td).text().trim()).get();
    if (values.length < 7) return;
    if (!/^\d+$/.test(values[5]) || !/^\d+$/.test(values[6])) return;
    servers.push({
      name: values[0],
      module: values[1],
      gameType: values[2],
      map: values[3] || 'unknown',
      region: values[4],
      players: Number(values[5]),
      maxPlayers: Number(values[6]),
    });
  });
  return servers;
}
export async function loadServerList() {
  try {
    const all = parseServers(await fetchServerListHtml());
    if (all.length === 0) throw new Error('no servers parsed from the list');
    return all;
  } catch (err) {
    console.error(`Server list unavailable (${err.message}).`);
    return null;
  }
}
export function escapeMarkdown(text) {
  return String(text).replace(/([\\*_`~|>\[\]])/g, '\\$1');
}
export function shorten(text, max) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}
export function cleanMap(map) {
  return String(map || '').split('(')[0].trim() || 'unknown';
}
const TITLE_FONT_OFFSETS = { bold: [0x1d400, 0x1d41a, 0x1d7ce], sans: [0x1d5a0, 0x1d5ba, 0x1d7e2], sansbold: [0x1d5d4, 0x1d5ee, 0x1d7ec], mono: [0x1d670, 0x1d68a, 0x1d7f6], script: [0x1d4d0, 0x1d4ea], fraktur: [0x1d56c, 0x1d586] };
export function styleTitle(text, font = 'bold') {
  const offsets = TITLE_FONT_OFFSETS[font];
  if (!offsets) return text;
  return [...text].map((char) => {
    if (char >= 'A' && char <= 'Z') return String.fromCodePoint(offsets[0] + char.charCodeAt(0) - 65);
    if (char >= 'a' && char <= 'z') return String.fromCodePoint(offsets[1] + char.charCodeAt(0) - 97);
    if (offsets[2] && char >= '0' && char <= '9') return String.fromCodePoint(offsets[2] + char.charCodeAt(0) - 48);
    return char;
  }).join('');
}
export function resolveGameMode(server) {
  const mode = String(server.gameType || '').trim();
  const lowered = mode.toLowerCase();
  const sameAsMap = lowered === String(server.map || '').trim().toLowerCase() || lowered === cleanMap(server.map).toLowerCase();
  if (mode && mode !== 'N/A' && !sameAsMap && !/^custom map/i.test(mode)) return mode;
  return /amber/i.test(server.module) ? 'Invasion' : '';
}
export function shortModule(text) {
  return String(text || '').replace(/full invasion(?: 2)?(?:\s*-)?\s*/i, 'FI2 ').trim();
}
export function pickServers(all, { moduleKeyword, count, priority }) {
  const keyword = moduleKeyword.toLowerCase();
  const seenNames = new Set();
  const rank = (server) => {
    const tier = Number(priority(server)) || 0;
    return tier > 0 ? -tier : server.players > 0 ? 1 : 2;
  };
  return all
    .filter((server) => server.module.toLowerCase().includes(keyword))
    .sort((a, b) => rank(a) - rank(b) || b.players - a.players || a.name.localeCompare(b.name))
    .filter((server) => {
      const nameKey = server.name.toLowerCase();
      if (seenNames.has(nameKey) && server.players === 0) return false;
      seenNames.add(nameKey);
      return true;
    })
    .slice(0, count);
}
