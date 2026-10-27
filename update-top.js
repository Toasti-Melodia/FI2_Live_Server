import { loadServerList, escapeMarkdown, shorten, cleanMap, resolveGameMode } from './servers.js';
const WEBHOOK_URL = process.env.TOP_WEBHOOK_URL;
const MESSAGE_ID = process.env.TOP_MESSAGE_ID;
const TOP_ENABLED = process.env.TOP_ENABLED !== '0';
const TOP_COUNT = Number(process.env.TOP_COUNT) || 10;
if (!TOP_ENABLED) {
  console.log('Top servers monitor is switched off (TOP_ENABLED=0).');
  process.exit(0);
}
if (!WEBHOOK_URL || !MESSAGE_ID) {
  console.log('TOP_WEBHOOK_URL or TOP_MESSAGE_ID not set -- top servers monitor skipped.');
  process.exit(0);
}
function pickTop(all) {
  return all
    .filter((server) => server.players > 0)
    .sort((a, b) => b.players - a.players || b.maxPlayers - a.maxPlayers || a.name.localeCompare(b.name))
    .slice(0, TOP_COUNT);
}
const SEPARATOR = ' \u00A0-\u00A0 ';
function buildEntry(server, index) {
  const name = escapeMarkdown(shorten(server.name, 30));
  const moduleName = escapeMarkdown(shorten(server.module, 26));
  const gameMode = escapeMarkdown(shorten(resolveGameMode(server), 20));
  const map = escapeMarkdown(shorten(cleanMap(server.map), 28));
  const details = [moduleName, gameMode, map].filter(Boolean).join(SEPARATOR);
  return `**${index + 1}.** **${name}**${SEPARATOR}**${server.players}/${server.maxPlayers}**\n-# ${details}`;
}
async function main() {
  const all = await loadServerList();
  if (all === null) {
    console.log('Server list unavailable -- top message left unchanged.');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const top = pickTop(all);
  const entries = top.length > 0 ? top.map(buildEntry).join('\n\n') : 'No players online right now.';
  const description = `## __Warband Servers__\n\n${entries}`;
  const content = `-# Last update <t:${now}:t>`;
  const embeds = [{ description, color: 0xd4af37 }];
  const res = await fetch(`${WEBHOOK_URL}/messages/${MESSAGE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, embeds, allowed_mentions: { parse: [] } }),
  });
  if (res.status === 404) throw new Error('Top message not found (HTTP 404) -- check TOP_MESSAGE_ID.');
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  console.log(`Top message updated with ${top.length} servers.`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
