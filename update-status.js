import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { renderMonitor, resolveMapImage } from './render-card.js';
import { TOP_COUNT, parseSettings } from './live-info.js';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID;
const SEED_EXTRA_IDS = [process.env.DISCORD_MESSAGE_ID_2, process.env.DISCORD_MESSAGE_ID_3].filter(Boolean);
const MAX_CARDS = 6;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.GONDOLIN_STATUS_CHANNEL_ID;
const NAME_KEYWORD = process.env.SERVER_KEYWORD || 'Gondolin';
const CARD_MODULE_KEYWORD = process.env.MODULE_KEYWORD || 'osiris';
const CHANNEL_MODULE_KEYWORD = process.env.CHANNEL_MODULE_KEYWORD || 'full invasion';
const CHANNEL_PREFIX = process.env.CHANNEL_PREFIX || '📺┃𝐋𝐢𝐯𝐞-𝐒𝐞𝐫𝐯𝐞𝐫';
const CHANNEL_SEPARATOR = process.env.CHANNEL_SEPARATOR || '┃';
const SERVER_LIST_URL = process.env.SERVER_LIST_URL || 'http://www.mnbcentral.net/';
const MAPS_DIR = new URL('./maps', import.meta.url).pathname;
const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const DISPLAY_MODE = process.env.DISPLAY_MODE || 'image';
const LIVE_MAX_AGE_MS = (Number(process.env.LIVE_MAX_AGE_MIN) || 10) * 60 * 1000;
const LIVE_TIMEOUT_MS = (Number(process.env.LIVE_TIMEOUT_SEC) || 20) * 1000;
const MAP_WAIT_MS = (Number(process.env.MAP_WAIT_SEC) || 60) * 1000;
const MAP_POLL_MS = (Number(process.env.MAP_POLL_SEC) || 10) * 1000;
const DEFAULT_SETTINGS = { difficulty: 1 };
if (!WEBHOOK_URL || !MESSAGE_ID) {
  console.error('Missing DISCORD_WEBHOOK_URL or DISCORD_MESSAGE_ID (repo secrets).');
  process.exit(1);
}
async function fetchServerListHtml() {
  const res = await fetch(SERVER_LIST_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MelodiaServerMonitor/2.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching server list`);
  return res.text();
}
function parseServers(html) {
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
function stateKey(name, map) {
  return createHash('sha1').update(`${name}|${map}`).digest('hex').slice(0, 8);
}
function messageUrl(id) {
  return `${WEBHOOK_URL}/messages/${id}`;
}
async function fetchFirstMessage() {
  const res = await fetch(messageUrl(MESSAGE_ID));
  if (!res.ok) throw new Error(`Cannot read first status message: HTTP ${res.status}`);
  const data = await res.json();
  const filename = data.attachments?.[0]?.filename || '';
  const match = filename.match(/^mm-[0-9a-z]+-([0-9a-z._]+?)(?:-([0-9a-z_]+))?\.(?:jpg|png)$/);
  if (!match) return { state: {}, extra: null };
  const state = {};
  for (const entry of match[1].split('_')) {
    const [key, since] = entry.split('.');
    if (key && since && key !== 'none') state[key] = parseInt(since, 36);
  }
  const extra = match[2] === undefined ? null : match[2].split('_').filter((v) => /^\d+$/.test(v));
  return { state, extra };
}
function buildCards(listed, previous, now) {
  const cards = listed.map((server) => {
    const key = stateKey(server.name, server.map);
    return { ...server, key, since: previous[key] ?? now };
  });
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards.slice(0, MAX_CARDS);
}
function parseLive(data) {
  const players = String(data.top || '')
    .split(';')
    .map((entry) => {
      const cut = entry.lastIndexOf('|');
      if (cut < 1) return null;
      return { name: entry.slice(0, cut), kills: Number(entry.slice(cut + 1)) || 0 };
    })
    .filter(Boolean)
    .slice(0, TOP_COUNT);
  const count = data.players === undefined || data.players === '' ? null : Number(data.players);
  const max = data.maxplayers === undefined || data.maxplayers === '' ? null : Number(data.maxplayers);
  return {
    players,
    name: String(data.server || '').trim(),
    map: String(data.map || '').trim(),
    count: Number.isFinite(count) ? count : null,
    max: Number.isFinite(max) && max > 0 ? max : null,
    defenders: data.df || '',
    invaders: data.inv || '',
    wave: Number(data.wavenumber) || 0,
    exportedAt: Number(data.exportedAt) || 0,
    settings: parseSettings(data),
  };
}
function liveSources() {
  const sources = [];
  for (const n of [1, 2]) {
    const host = process.env[`LIVE_${n}_HOST`];
    const path = process.env[`LIVE_${n}_PATH`];
    if (!host || !path) continue;
    sources.push({
      n,
      host,
      port: Number(process.env[`LIVE_${n}_PORT`]) || 8822,
      username: process.env[`LIVE_${n}_USER`],
      password: process.env[`LIVE_${n}_PASS`],
      path,
    });
  }
  return sources;
}
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function downloadLive(sftp, source) {
  await sftp.connect({ host: source.host, port: source.port, username: source.username, password: source.password, readyTimeout: 10000 });
  const stat = await sftp.stat(source.path);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const buffer = await sftp.get(source.path);
      const parsed = JSON.parse(buffer.toString('utf8'));
      parsed.exportedAt = Math.floor(stat.modifyTime / 1000);
      return parsed;
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return null;
}
async function readLiveSource(source) {
  const sftp = new SftpClient();
  try {
    const data = await withTimeout(downloadLive(sftp, source), LIVE_TIMEOUT_MS, `Live source ${source.n}`);
    if (data) console.log(`Live source ${source.n}: read OK, server "${data.server}".`);
    return data;
  } catch (err) {
    console.error(`Live source ${source.n} skipped: ${err.message}`);
    return null;
  } finally {
    sftp.end().catch(() => {});
  }
}
async function fetchLive() {
  const result = {};
  const sources = liveSources();
  if (sources.length === 0) {
    console.log('No LIVE_1_HOST / LIVE_1_PATH -- skipping top 10 panel.');
    return result;
  }
  const all = await Promise.all(sources.map((source) => readLiveSource(source)));
  for (const data of all) {
    if (data && data.server) result[String(data.server).trim().toLowerCase()] = parseLive(data);
  }
  return result;
}
function buildLiveCards(live, previous, now) {
  const cards = [];
  for (const data of Object.values(live)) {
    if (!data.name || !data.name.toLowerCase().includes(NAME_KEYWORD.toLowerCase())) continue;
    if (data.exportedAt > 0 && now - data.exportedAt > LIVE_MAX_AGE_MS / 1000) {
      console.log(`Live source "${data.name}" is older than ${LIVE_MAX_AGE_MS / 60000} min -- cannot build a fallback card.`);
      continue;
    }
    if (data.count === null) {
      console.log(`Live source "${data.name}" has no player count -- cannot build a fallback card.`);
      continue;
    }
    const map = data.map || 'unknown';
    const key = stateKey(data.name, map);
    cards.push({ name: data.name, module: '', gameType: '', map, region: '', players: data.count, maxPlayers: data.max, key, since: previous[key] ?? now });
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards.slice(0, MAX_CARDS);
}
async function loadServerList() {
  try {
    const all = parseServers(await fetchServerListHtml());
    if (all.length === 0) throw new Error('no servers parsed from the list');
    return all;
  } catch (err) {
    console.error(`Server list unavailable (${err.message}) -- falling back to live data.`);
    return null;
  }
}
function pickLive(live, card) {
  return live[card.name.trim().toLowerCase()] || null;
}
function normalizeMap(value) {
  return String(value || '').split('(')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}
function liveMapMatches(data, card) {
  const liveMap = normalizeMap(data.map);
  const cardMap = normalizeMap(card.map);
  if (!liveMap || !cardMap) return true;
  return liveMap.includes(cardMap) || cardMap.includes(liveMap);
}
function resetSettingsForNewMap(data, card) {
  if (!data || data.exportedAt === 0 || data.exportedAt >= card.since) return data;
  console.log(`${card.name}: live JSON was exported before this map started -- poll settings and custom invasion reset to default.`);
  return { ...data, settings: { ...DEFAULT_SETTINGS } };
}
function findStaleCards(cards, live, now) {
  return cards.filter((card) => {
    if (card.since !== now) return false;
    const data = pickLive(live, card);
    return data !== null && !liveMapMatches(data, card);
  });
}
async function waitForFreshLive(cards, live, now) {
  const deadline = Date.now() + MAP_WAIT_MS;
  let current = live;
  let stale = findStaleCards(cards, current, now);
  while (stale.length > 0 && Date.now() < deadline) {
    for (const card of stale) {
      console.log(`${card.name}: map is "${card.map}" but live JSON still says "${pickLive(current, card).map}" -- waiting ${MAP_POLL_MS / 1000}s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, MAP_POLL_MS));
    current = { ...current, ...(await fetchLive()) };
    stale = findStaleCards(cards, current, now);
  }
  return { live: current, stale };
}
function buildForm(image, filename, now) {
  const attachments = [{ id: 0, filename }];
  const payload = DISPLAY_MODE === 'image'
    ? { content: `-# Last update <t:${now}:t>`, embeds: [], attachments }
    : {
        content: '',
        embeds: [
          {
            color: 0xd4af37,
            image: { url: `attachment://${filename}` },
            footer: { text: 'Last update' },
            timestamp: new Date(now * 1000).toISOString(),
          },
        ],
        attachments,
      };
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([image], { type: 'image/png' }), filename);
  return form;
}
async function writeMessage(id, image, filename, now) {
  const res = await fetch(messageUrl(id), { method: 'PATCH', body: buildForm(image, filename, now) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  console.log(`Status message ${id} updated.`);
  return id;
}
async function createMessage(image, filename, now) {
  const res = await fetch(`${WEBHOOK_URL}?wait=true`, { method: 'POST', body: buildForm(image, filename, now) });
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  const id = (await res.json()).id;
  console.log(`Status message ${id} created.`);
  return id;
}
async function deleteMessage(id) {
  const res = await fetch(messageUrl(id), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) console.error(`Failed to delete message ${id}: HTTP ${res.status}`);
  else console.log(`Status message ${id} deleted.`);
}
async function updateChannel(total) {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    console.log('No DISCORD_BOT_TOKEN or GONDOLIN_STATUS_CHANNEL_ID -- skipping channel rename.');
    return;
  }
  const headers = { Authorization: `Bot ${BOT_TOKEN}` };
  const res = await fetch(`${API}/channels/${CHANNEL_ID}`, { headers });
  if (!res.ok) throw new Error(`Failed to read channel: HTTP ${res.status}`);
  const current = (await res.json()).name;
  if (current.startsWith(CHANNEL_PREFIX) && current.replace(/\D/g, '') === String(total)) {
    console.log(`Channel name unchanged: "${current}"`);
    return;
  }
  const desired = `${CHANNEL_PREFIX}${CHANNEL_SEPARATOR}${total}${CHANNEL_SEPARATOR}`;
  const patch = await fetch(`${API}/channels/${CHANNEL_ID}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: desired }),
  });
  if (patch.status === 429) {
    const body = await patch.json();
    console.log(`Rate limited, retry after ${body.retry_after}s -- will try again on the next run.`);
    return;
  }
  if (!patch.ok) {
    throw new Error(`Failed to rename channel: HTTP ${patch.status} ${await patch.text()}`);
  }
  console.log(`Channel renamed: "${current}" -> "${desired}"`);
}
async function main() {
  const all = await loadServerList();
  const channelTotal = all === null ? null : all
    .filter((s) => s.module.toLowerCase().includes(CHANNEL_MODULE_KEYWORD.toLowerCase()))
    .reduce((sum, s) => sum + s.players, 0);
  const listed = all === null ? [] : all.filter(
    (s) => s.module.toLowerCase().includes(CARD_MODULE_KEYWORD.toLowerCase()) && s.name.toLowerCase().includes(NAME_KEYWORD.toLowerCase())
  );
  const first = await fetchFirstMessage();
  const previous = first.state;
  const now = Math.floor(Date.now() / 1000);
  const fetchedLive = await fetchLive();
  console.log(`Live data available for: ${Object.keys(fetchedLive).join(', ') || 'none'}`);
  const cards = all === null ? buildLiveCards(fetchedLive, previous, now) : buildCards(listed, previous, now);
  const { live, stale } = await waitForFreshLive(cards, fetchedLive, now);
  const staleKeys = new Set(stale.map((card) => card.key));
  for (const card of cards) {
    const isStale = staleKeys.has(card.key);
    if (isStale) console.log(`${card.name}: live JSON still has the old map after ${MAP_WAIT_MS / 1000}s -- panel left empty instead of showing old data.`);
    const data = isStale ? null : resetSettingsForNewMap(pickLive(live, card), card);
    card.live = data && card.players === 0 ? { ...data, players: [] } : data || null;
    console.log(`${card.name}: top 10 panel ${card.live ? `${card.live.players.length} players` : 'none'}`);
  }
  for (const card of cards) {
    const file = resolveMapImage(MAPS_DIR, card.map);
    console.log(`${card.name}: ${card.maxPlayers ? `${card.players}/${card.maxPlayers}` : card.players} map "${card.map}" -> ${file ? `maps/${basename(file)}` : 'no image'}`);
  }
  const existingExtra = first.extra ?? SEED_EXTRA_IDS;
  const slots = cards.length === 0 ? [[]] : cards.map((card) => [card]);
  const extraIds = [];
  for (let i = 1; i < slots.length; i++) {
    const old = existingExtra[i - 1];
    try {
      const image = await renderMonitor({ cards: slots[i], now, mapsDir: MAPS_DIR, keyword: NAME_KEYWORD });
      const filename = `mm-${now.toString(36)}-${slots[i][0].key}.${slots[i][0].since.toString(36)}.png`;
      let id = old ? await writeMessage(old, image, filename, now) : null;
      if (!id) id = await createMessage(image, filename, now);
      extraIds.push(id);
    } catch (err) {
      console.error(`Card ${i + 1} failed: ${err.message}`);
      process.exitCode = 1;
      if (old) extraIds.push(old);
    }
  }
  for (const id of existingExtra.slice(slots.length - 1)) await deleteMessage(id);
  const image = await renderMonitor({ cards: slots[0], now, mapsDir: MAPS_DIR, keyword: NAME_KEYWORD });
  const encoded = cards.map((c) => `${c.key}.${c.since.toString(36)}`).join('_') || 'none';
  const filename = `mm-${now.toString(36)}-${encoded}-${extraIds.join('_') || 'none'}.png`;
  if (!(await writeMessage(MESSAGE_ID, image, filename, now))) throw new Error('First status message was not found (HTTP 404) -- check DISCORD_MESSAGE_ID.');
  try {
    if (channelTotal === null) console.log('Server list unavailable -- channel name left unchanged.');
    else await updateChannel(channelTotal);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
