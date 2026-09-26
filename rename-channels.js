import * as cheerio from 'cheerio';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID_1 = process.env.GONDOLIN_CHANNEL_1_ID;
const CHANNEL_ID_2 = process.env.GONDOLIN_CHANNEL_2_ID;
const KEYWORD = process.env.SERVER_KEYWORD || 'Gondolin';

if (!BOT_TOKEN || !CHANNEL_ID_1 || !CHANNEL_ID_2) {
  console.error('Missing DISCORD_BOT_TOKEN, GONDOLIN_CHANNEL_1_ID or GONDOLIN_CHANNEL_2_ID -- skipping channel rename.');
  process.exit(1);
}

const SERVER_LIST_URL = 'http://www.mnbcentral.net/';
const API = 'https://discord.com/api/v10';

async function fetchServerListHtml() {
  const res = await fetch(SERVER_LIST_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GondolinStatusBot/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching server list`);
  return res.text();
}

function findServers(html, keyword) {
  const $ = cheerio.load(html);
  const matches = [];

  $('tr').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    if (cells.length === 0) return;

    const nameCell = cells.eq(0);
    const name = nameCell.text().trim();
    if (!name || !name.toLowerCase().includes(keyword.toLowerCase())) return;

    const values = cells.map((__, td) => $(td).text().trim()).get();
    const numericValues = values.filter((v) => /^\d+$/.test(v)).map(Number);

    matches.push({
      name,
      map: values[3] || 'unknown',
      players: numericValues.length > 0 ? numericValues[0] : null,
      maxPlayers: numericValues.length > 1 ? numericValues[1] : null,
    });
  });

  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches;
}

function shortLabel(name) {
  const prefix = `${KEYWORD}_`;
  if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
    return name.slice(prefix.length);
  }
  return name;
}

function buildChannelName(server) {
  if (!server || server.players === null) {
    return server ? `⚫ ${shortLabel(server.name)} offline` : `⚫ ${KEYWORD} offline`;
  }

  const dot = server.players > 0 ? '🟢' : '⚪';
  const label = shortLabel(server.name);

  return `${dot} ${label} [${server.players}/${server.maxPlayers ?? '?'}]`;
}

async function getCurrentChannelName(channelId) {
  const res = await fetch(`${API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Failed to read channel ${channelId}: HTTP ${res.status}`);
  const data = await res.json();
  return data.name;
}

async function renameChannel(channelId, newName) {
  const res = await fetch(`${API}/channels/${channelId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${text}`);
  }
}

async function main() {
  const html = await fetchServerListHtml();
  const servers = findServers(html, KEYWORD);
  const channelIds = [CHANNEL_ID_1, CHANNEL_ID_2];

  for (let i = 0; i < channelIds.length; i++) {
    const channelId = channelIds[i];
    const server = servers[i] || null;

    try {
      const desiredName = buildChannelName(server);
      const currentName = await getCurrentChannelName(channelId);

      if (currentName === desiredName) {
        console.log(`[${i + 1}] No change: "${currentName}"`);
        continue;
      }

      await renameChannel(channelId, desiredName);
      console.log(`[${i + 1}] Renamed: "${currentName}" -> "${desiredName}"`);
    } catch (err) {
      console.error(`[${i + 1}] Error:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
