import * as cheerio from 'cheerio';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID;
const KEYWORD = process.env.SERVER_KEYWORD || 'Gondolin';

if (!WEBHOOK_URL || !MESSAGE_ID) {
  console.error('Missing DISCORD_WEBHOOK_URL or DISCORD_MESSAGE_ID (repo secrets).');
  process.exit(1);
}

const SERVER_LIST_URL = 'http://www.mnbcentral.net/';

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
    const link = nameCell.find('a').attr('href') || null;

    matches.push({
      name,
      module: values[1] || 'unknown',
      gameType: values[2] || '',
      map: values[3] || 'unknown',
      region: values[4] || '',
      players: numericValues.length > 0 ? numericValues[0] : null,
      maxPlayers: numericValues.length > 1 ? numericValues[1] : null,
      link,
    });
  });

  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches;
}

function buildEmbed(html) {
  const servers = findServers(html, KEYWORD);

  const serverBlocks = servers.map((server) => {
    if (server.players === null) {
      return `**${server.name}**\n⚫ **Server not currently listed (offline or temporarily unavailable)**`;
    }

    const statusDot = server.players > 0 ? '🟢' : '⚪';
    return (
      `**${server.name}**\n` +
      `${statusDot} **${server.players}/${server.maxPlayers ?? '?'}** players\n` +
      `🗺️ Map: \`${server.map}\``
    );
  });

  const body = serverBlocks.length > 0
    ? serverBlocks.join('\n\n')
    : `⚫ No servers matching "${KEYWORD}" found`;

  return {
    title: 'Full Invasion 2 - Gondolin',
    description:
      `──────────────────────────────\n\n` +
      `${body}\n\n` +
      `──────────────────────────────\n` +
      `Check More: [mnbcentral.net](${SERVER_LIST_URL})\n` +
      `**Melodia FI2 Server Monitor • Last update**`,
    color: 0x2ecc71,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  const html = await fetchServerListHtml();
  const embed = buildEmbed(html);

  const res = await fetch(`${WEBHOOK_URL}/messages/${MESSAGE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API error ${res.status}: ${text}`);
  }

  console.log('Status message updated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
