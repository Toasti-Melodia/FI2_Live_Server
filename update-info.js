import { loadServerList, pickServers, escapeMarkdown, shorten, cleanMap, shortModule, styleTitle, resolveGameMode } from './servers.js';
import { sendMessage } from './discord-state.js';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.INFO_MESSAGE_ID;
const INFO_ENABLED = process.env.INFO_ENABLED !== '0';
const INFO_COUNT = Math.min(Number(process.env.INFO_COUNT) || 4, 6);
const INFO_MODULE_KEYWORD = process.env.INFO_MODULE_KEYWORD || 'full invasion';
const INFO_NAME_KEYWORD = process.env.SERVER_KEYWORD || 'Gondolin';
const TITLE_FONT = process.env.INFO_TITLE_FONT || 'sans';
const HEADER_TEXT = 'Full Invasion servers';
const NAME_WIDTH = Number(process.env.INFO_NAME_WIDTH) || 20;
const MIN_WORD_LETTERS = 3;
const COLOR = 0xd4af37;
const BLANK = '\u200b';
const ONLINE_SQUARE = '🟩';
const EMPTY_SQUARE = '🟪';
if (!INFO_ENABLED) {
  console.log('Server list message is switched off (INFO_ENABLED=0).');
  process.exit(0);
}
if (!WEBHOOK_URL || !MESSAGE_ID) {
  console.log('DISCORD_WEBHOOK_URL or INFO_MESSAGE_ID not set -- server list message skipped.');
  process.exit(0);
}
function charWidth(char) {
  if ('iljt.,\'!|:;'.includes(char)) return 0.45;
  if (char === ' ' || 'fr'.includes(char)) return 0.55;
  if ('mwMW'.includes(char)) return 1.4;
  if (char >= 'A' && char <= 'Z') return 1.15;
  return 1;
}
function textWidth(text) {
  return [...text].reduce((total, char) => total + charWidth(char), 0);
}
function fitName(text) {
  if (textWidth(text) <= NAME_WIDTH) return text;
  const chars = [...text];
  let count = chars.length;
  while (count > 1 && textWidth(chars.slice(0, count).join('')) + charWidth('…') > NAME_WIDTH) count -= 1;
  let result = chars.slice(0, count).join('');
  const cutInsideWord = chars[count] !== ' ' && chars[count - 1] !== ' ';
  const lastSpace = result.lastIndexOf(' ');
  if (cutInsideWord && lastSpace > 0 && result.length - lastSpace - 1 < MIN_WORD_LETTERS) result = result.slice(0, lastSpace);
  return `${result.trimEnd()}…`;
}
function buildField(server) {
  const title = styleTitle(fitName(server.name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()), TITLE_FONT);
  const square = server.players > 0 ? ONLINE_SQUARE : EMPTY_SQUARE;
  const mode = resolveGameMode(server);
  const lines = [`**Players:** ${server.players}/${server.maxPlayers}`];
  if (mode) lines.push(`**Mode:** ${escapeMarkdown(shorten(mode, 20))}`);
  lines.push(`**Module:** ${escapeMarkdown(shorten(shortModule(server.module), 30))}`);
  lines.push(`**Map:** ${escapeMarkdown(shorten(cleanMap(server.map), 40))}`);
  return { name: `${square} __${escapeMarkdown(title)}__`, value: lines.join('\n'), inline: true };
}
function buildFields(servers) {
  const fields = [];
  for (let index = 0; index < servers.length; index += 2) {
    fields.push(buildField(servers[index]));
    fields.push({ name: BLANK, value: BLANK, inline: true });
    fields.push(servers[index + 1] ? buildField(servers[index + 1]) : { name: BLANK, value: BLANK, inline: true });
    if (index + 2 < servers.length) fields.push({ name: BLANK, value: BLANK, inline: false });
  }
  return fields;
}
async function main() {
  const all = await loadServerList();
  if (all === null) {
    console.log('Server list unavailable -- server list message left unchanged.');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const keyword = INFO_NAME_KEYWORD.toLowerCase();
  const servers = pickServers(all, {
    moduleKeyword: INFO_MODULE_KEYWORD,
    count: INFO_COUNT,
    priority: (server) => server.name.toLowerCase().includes(keyword),
  });
  const content = `-# Last update <t:${now}:t>`;
  const files = [];
  let embeds;
  if (servers.length > 0) {
    embeds = [{ color: COLOR, description: `-# ${HEADER_TEXT}`, fields: buildFields(servers) }];
  } else {
    embeds = [{ color: COLOR, description: `-# ${HEADER_TEXT}\n\nNo Full Invasion servers listed right now.` }];
  }
  const res = await sendMessage(WEBHOOK_URL, MESSAGE_ID, content, embeds, files);
  if (res.status === 404) throw new Error('Server list message not found (HTTP 404) -- check INFO_MESSAGE_ID.');
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  console.log(`Server list message updated with ${servers.length} servers.`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
