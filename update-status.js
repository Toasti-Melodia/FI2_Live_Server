import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { renderMonitor, resolveMapImage } from './render-card.js';
import { loadServerList, cleanMap } from './servers.js';
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
const MAPS_DIR = new URL('./maps', import.meta.url).pathname;
const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const LIVE_MAX_AGE_MS = (Number(process.env.LIVE_MAX_AGE_MIN) || 10) * 60 * 1000;
const LIVE_TIMEOUT_MS = (Number(process.env.LIVE_TIMEOUT_SEC) || 20) * 1000;
const MAP_WAIT_MS = (Number(process.env.MAP_WAIT_SEC) || 60) * 1000;
const MAP_POLL_MS = (Number(process.env.MAP_POLL_SEC) || 10) * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_SETTINGS = { difficulty: 1 };
if (!WEBHOOK_URL || !MESSAGE_ID) {
  console.error('Missing DISCORD_WEBHOOK_URL or DISCORD_MESSAGE_ID (repo secrets).');
  process.exit(1);
}
function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}
function stateKey(name, map) {
  return createHash('sha1').update(`${name}|${cleanMap(map)}`).digest('hex').slice(0, 8);
}
function messageUrl(id) {
  return `${WEBHOOK_URL}/messages/${id}`;
}
async function fetchFirstMessage() {
  const res = await request(messageUrl(MESSAGE_ID));
  if (!res.ok) throw new Error(`Cannot read first status message: HTTP ${res.status}`);
  const data = await res.json();
  const filename = data.attachments?.[0]?.filename || '';
  const match = filename.match(/^mm-[0-9a-z]+-([0-9a-z._]+?)(?:-([0-9a-z_]+))?\.(?:jpg|png)$/);
  if (!match) return { state: {}, extra: null };
  const state = {};
  for (const entry of match[1].split('_')) {
    const [key, since, started] = entry.split('.');
    if (key && since && key !== 'none') {
      const sinceValue = parseInt(since, 36);
      state[key] = { since: sinceValue, started: started === undefined ? sinceValue : parseInt(started, 36) };
    }
  }
  const extra = match[2] === undefined ? null : match[2].split('_').filter((value) => /^\d+$/.test(value));
  return { state, extra };
}
function finalizeCards(cards) {
  const byName = new Map();
  for (const card of cards) {
    const nameKey = card.name.trim().toLowerCase();
    const existing = byName.get(nameKey);
    if (!existing || card.players > existing.players) byName.set(nameKey, card);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_CARDS);
}
function buildCards(listed, previous, now) {
  return finalizeCards(listed.map((server) => {
    const key = stateKey(server.name, server.map);
    return { ...server, key, since: previous[key]?.since ?? now, started: previous[key]?.started ?? 0 };
  }));
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
  for (const number of [1, 2]) {
    const host = process.env[`LIVE_${number}_HOST`];
    const path = process.env[`LIVE_${number}_PATH`];
    if (!host || !path) continue;
    sources.push({
      number,
      host,
      port: Number(process.env[`LIVE_${number}_PORT`]) || 8822,
      username: process.env[`LIVE_${number}_USER`],
      password: process.env[`LIVE_${number}_PASS`],
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
  for (let attempt = 0; ; attempt++) {
    try {
      const buffer = await sftp.get(source.path);
      const parsed = JSON.parse(buffer.toString('utf8'));
      parsed.exportedAt = Math.floor(stat.modifyTime / 1000);
      return parsed;
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
async function readLiveSource(source) {
  const sftp = new SftpClient();
  try {
    const data = await withTimeout(downloadLive(sftp, source), LIVE_TIMEOUT_MS, `Live source ${source.number}`);
    console.log(`Live source ${source.number}: read OK, server "${data.server}".`);
    return data;
  } catch (err) {
    console.error(`Live source ${source.number} skipped: ${err.message}`);
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
    cards.push({ name: data.name, module: '', gameType: '', map, region: '', players: data.count, maxPlayers: data.max, key, since: previous[key]?.since ?? now, started: previous[key]?.started ?? 0 });
  }
  return finalizeCards(cards);
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
  const payload = {
    content: `-# Last update <t:${now}:t>`,
    embeds: [],
    attachments: [{ id: 0, filename }],
    allowed_mentions: { parse: [] },
  };
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([image], { type: 'image/png' }), filename);
  return form;
}
async function writeMessage(id, image, filename, now) {
  const res = await request(messageUrl(id), { method: 'PATCH', body: buildForm(image, filename, now) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  console.log(`Status message ${id} updated.`);
  return id;
}
async function createMessage(image, filename, now) {
  const res = await request(`${WEBHOOK_URL}?wait=true`, { method: 'POST', body: buildForm(image, filename, now) });
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  const id = (await res.json()).id;
  console.log(`Status message ${id} created.`);
  return id;
}
async function deleteMessage(id) {
  try {
    const res = await request(messageUrl(id), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) console.error(`Failed to delete message ${id}: HTTP ${res.status}`);
    else console.log(`Status message ${id} deleted.`);
  } catch (err) {
    console.error(`Failed to delete message ${id}: ${err.message}`);
  }
}
async function updateChannel(total) {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    console.log('No DISCORD_BOT_TOKEN or GONDOLIN_STATUS_CHANNEL_ID -- skipping channel rename.');
    return;
  }
  const headers = { Authorization: `Bot ${BOT_TOKEN}` };
  const res = await request(`${API}/channels/${CHANNEL_ID}`, { headers });
  if (!res.ok) throw new Error(`Failed to read channel: HTTP ${res.status}`);
  const current = (await res.json()).name;
  if (current.startsWith(CHANNEL_PREFIX) && current.replace(/\D/g, '') === String(total)) {
    console.log(`Channel name unchanged: "${current}"`);
    return;
  }
  const desired = `${CHANNEL_PREFIX}${CHANNEL_SEPARATOR}${total}${CHANNEL_SEPARATOR}`;
  const patch = await request(`${API}/channels/${CHANNEL_ID}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: desired }),
  });
  if (patch.status === 429) {
    const body = await patch.json();
    console.log(`Rate limited, retry after ${body.retry_after}s -- will try again on the next run.`);
    return;
  }
  if (!patch.ok) throw new Error(`Failed to rename channel: HTTP ${patch.status} ${await patch.text()}`);
  console.log(`Channel renamed: "${current}" -> "${desired}"`);
}
async function renderSlots(slots, now) {
  const images = [];
  for (const slot of slots) {
    try {
      images.push(await renderMonitor({ cards: slot, now, mapsDir: MAPS_DIR, keyword: NAME_KEYWORD }));
    } catch (err) {
      console.error(`Card render failed: ${err.message}`);
      images.push(null);
    }
  }
  return images;
}
async function main() {
  const all = await loadServerList();
  const listUnavailable = all === null;
  const channelTotal = listUnavailable ? null : all
    .filter((server) => server.module.toLowerCase().includes(CHANNEL_MODULE_KEYWORD.toLowerCase()))
    .reduce((sum, server) => sum + server.players, 0);
  const listed = listUnavailable ? [] : all.filter(
    (server) => server.module.toLowerCase().includes(CARD_MODULE_KEYWORD.toLowerCase()) && server.name.toLowerCase().includes(NAME_KEYWORD.toLowerCase())
  );
  const first = await fetchFirstMessage();
  const now = Math.floor(Date.now() / 1000);
  const fetchedLive = await fetchLive();
  console.log(`Live data available for: ${Object.keys(fetchedLive).join(', ') || 'none'}`);
  const cards = listUnavailable ? buildLiveCards(fetchedLive, first.state, now) : buildCards(listed, first.state, now);
  const { live, stale } = await waitForFreshLive(cards, fetchedLive, now);
  const staleKeys = new Set(stale.map((card) => card.key));
  for (const card of cards) {
    const isStale = staleKeys.has(card.key);
    if (isStale) console.log(`${card.name}: live JSON still has the old map after ${MAP_WAIT_MS / 1000}s -- panel left empty instead of showing old data.`);
    const data = isStale ? null : resetSettingsForNewMap(pickLive(live, card), card);
    card.live = data && card.players === 0 ? { ...data, players: [] } : data || null;
    console.log(`${card.name}: top 10 panel ${card.live ? `${card.live.players.length} players` : 'none'}`);
    if (card.live) {
      if (card.live.wave < 2) card.started = 0;
      else if (card.players > 0 && card.started === 0) card.started = now;
    }
    const file = resolveMapImage(MAPS_DIR, card.map);
    console.log(`${card.name}: ${card.maxPlayers ? `${card.players}/${card.maxPlayers}` : card.players} map "${card.map}" -> ${file ? `maps/${basename(file)}` : 'no image'}`);
  }
  const slots = cards.length === 0 ? [[]] : cards.map((card) => [card]);
  const images = await renderSlots(slots, now);
  if (!images[0]) throw new Error('First card could not be rendered -- nothing was changed on Discord.');
  const existingExtra = first.extra ?? SEED_EXTRA_IDS;
  const surplus = existingExtra.slice(slots.length - 1);
  const createdIds = [];
  const extraIds = [];
  try {
    for (let index = 1; index < slots.length; index++) {
      const previousId = existingExtra[index - 1];
      if (!images[index]) {
        process.exitCode = 1;
        if (previousId) extraIds.push(previousId);
        continue;
      }
      const card = slots[index][0];
      const filename = `mm-${now.toString(36)}-${card.key}.${card.since.toString(36)}.${card.started.toString(36)}.png`;
      try {
        let id = previousId ? await writeMessage(previousId, images[index], filename, now) : null;
        if (!id) {
          id = await createMessage(images[index], filename, now);
          createdIds.push(id);
        }
        extraIds.push(id);
      } catch (err) {
        console.error(`Card ${index + 1} failed: ${err.message}`);
        process.exitCode = 1;
        if (previousId) extraIds.push(previousId);
      }
    }
    if (listUnavailable) extraIds.push(...surplus);
    const encoded = cards.map((card) => `${card.key}.${card.since.toString(36)}.${card.started.toString(36)}`).join('_') || 'none';
    const filename = `mm-${now.toString(36)}-${encoded}-${extraIds.join('_') || 'none'}.png`;
    if (!(await writeMessage(MESSAGE_ID, images[0], filename, now))) throw new Error('First status message was not found (HTTP 404) -- check DISCORD_MESSAGE_ID.');
  } catch (err) {
    for (const id of createdIds) await deleteMessage(id);
    throw err;
  }
  if (!listUnavailable) for (const id of surplus) await deleteMessage(id);
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
