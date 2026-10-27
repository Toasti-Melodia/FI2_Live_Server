import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { loadServerList, pickServers, escapeMarkdown, shorten, cleanMap, shortModule, styleTitle, resolveGameMode } from './servers.js';
import { SPACER_PNG, stateKey, fetchPreviousState, buildStateName, formatAgo, sendMessage } from './discord-state.js';
const WEBHOOK_URL = process.env.AMBER_WEBHOOK_URL;
const MESSAGE_ID = process.env.AMBER_MESSAGE_ID;
const AMBER_ENABLED = process.env.AMBER_ENABLED !== '0';
const AMBER_COUNT = Math.min(Number(process.env.AMBER_COUNT) || 4, 6);
const AMBER_MODULE_KEYWORD = process.env.AMBER_MODULE_KEYWORD || 'full invasion';
const AMBER_PRIORITY_KEYWORD = process.env.AMBER_PRIORITY_KEYWORD || 'amber';
const AMBER_NAME_KEYWORD = process.env.AMBER_NAME_KEYWORD || 'gondolin';
const COLOR_ONLINE = 0x22c55e;
const COLOR_EMPTY = 0x475569;
const ICON_SIZE = 160;
const ICON_TOP_MARGIN = 24;
const TITLE_FONT = process.env.AMBER_TITLE_FONT || 'bold';
const ICONS = [
  { keyword: 'amber', file: 'amber.jpg' },
  { keyword: 'osiris', file: 'osiris.jpg' },
];
if (!AMBER_ENABLED) {
  console.log('Amber text monitor is switched off (AMBER_ENABLED=0).');
  process.exit(0);
}
if (!WEBHOOK_URL || !MESSAGE_ID) {
  console.log('AMBER_WEBHOOK_URL or AMBER_MESSAGE_ID not set -- Amber text monitor skipped.');
  process.exit(0);
}
function pickIconFile(server) {
  const moduleName = server.module.toLowerCase();
  return ICONS.find((icon) => moduleName.includes(icon.keyword))?.file;
}
async function loadIcon(file) {
  try {
    const source = await readFile(new URL(`./${file}`, import.meta.url));
    try {
      const image = await loadImage(source);
      const side = Math.min(image.width, image.height);
      const drawSize = ICON_SIZE - ICON_TOP_MARGIN;
      const canvas = createCanvas(ICON_SIZE, ICON_SIZE);
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, (ICON_SIZE - drawSize) / 2, ICON_TOP_MARGIN, drawSize, drawSize);
      return { name: `${file.replace(/\.[^.]+$/, '')}-icon.png`, data: canvas.toBuffer('image/png') };
    } catch (err) {
      console.error(`Could not resize ${file} (${err.message}) -- using the original.`);
      return { name: file, data: source };
    }
  } catch {
    console.error(`Icon ${file} not found next to update-amber.js -- skipped.`);
    return null;
  }
}
function field(name, value, limit) {
  return { name, value: escapeMarkdown(shorten(value, limit)) || '-', inline: true };
}
function buildEmbed(entry, now, iconFile, spacerName) {
  const { server, since } = entry;
  const hasPlayers = server.players > 0;
  const started = hasPlayers ? formatAgo(now - since) : 'No players';
  const title = styleTitle(shorten(server.name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim(), 22), TITLE_FONT);
  const embed = {
    color: hasPlayers ? COLOR_ONLINE : COLOR_EMPTY,
    description: `## 📺 __${escapeMarkdown(title)}__`,
    fields: [
      field('Players', `${server.players}/${server.maxPlayers}`, 20),
      field('Module', shortModule(server.module), 20),
      field('Map', cleanMap(server.map), 20),
      field('Game Mode', resolveGameMode(server), 20),
      field('Region', server.region, 20),
      { name: 'Game Started', value: started, inline: true },
    ],
    image: { url: `attachment://${spacerName}` },
  };
  if (iconFile) embed.thumbnail = { url: `attachment://${iconFile}` };
  return embed;
}
async function main() {
  const all = await loadServerList();
  if (all === null) {
    console.log('Server list unavailable -- Amber message left unchanged.');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const nameKeyword = AMBER_NAME_KEYWORD.toLowerCase();
  const priorityKeyword = AMBER_PRIORITY_KEYWORD.toLowerCase();
  const servers = pickServers(all, {
    moduleKeyword: AMBER_MODULE_KEYWORD,
    count: AMBER_COUNT,
    priority: (server) => {
      const hasName = server.name.toLowerCase().includes(nameKeyword);
      const hasModule = server.module.toLowerCase().includes(priorityKeyword);
      return hasName && hasModule ? 3 : hasName ? 2 : hasModule ? 1 : 0;
    },
  });
  const content = `-# Last update <t:${now}:t>`;
  const files = [];
  let embeds;
  if (servers.length > 0) {
    const previous = await fetchPreviousState(WEBHOOK_URL, MESSAGE_ID);
    const entries = servers.map((server) => {
      const key = stateKey(server);
      return { server, key, since: previous.get(key) ?? now };
    });
    const spacerName = buildStateName(entries, now);
    const iconFiles = new Map();
    for (const iconFile of new Set(servers.map(pickIconFile).filter(Boolean))) {
      const icon = await loadIcon(iconFile);
      if (icon) {
        files.push(icon);
        iconFiles.set(iconFile, icon.name);
      }
    }
    files.push({ name: spacerName, data: SPACER_PNG });
    embeds = entries.map((entry) => buildEmbed(entry, now, iconFiles.get(pickIconFile(entry.server)), spacerName));
  } else {
    embeds = [{ color: COLOR_EMPTY, description: 'No Full Invasion servers listed right now.' }];
  }
  const res = await sendMessage(WEBHOOK_URL, MESSAGE_ID, content, embeds, files);
  if (res.status === 404) throw new Error('Amber message not found (HTTP 404) -- check AMBER_MESSAGE_ID.');
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  console.log(`Amber message updated with ${servers.length} servers.`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
