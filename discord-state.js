import { createHash } from 'node:crypto';
import { cleanMap } from './servers.js';
export const SPACER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAZAAAAABCAYAAADw8vieAAAAFUlEQVR42mNgGAWjYBSMglEwCsgAAAZBAAElCJ3eAAAAAElFTkSuQmCC', 'base64');
const STATE_PATTERN = /^st-[0-9a-z]+-([0-9a-z._]+)\.png$/;
const REQUEST_TIMEOUT_MS = 20000;
export function stateKey(server) {
  return createHash('sha1').update(`${server.name}|${cleanMap(server.map)}`).digest('hex').slice(0, 5);
}
export async function fetchPreviousState(webhookUrl, messageId) {
  const previous = new Map();
  try {
    const res = await fetch(`${webhookUrl}/messages/${messageId}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`Could not read previous message ${messageId}: HTTP ${res.status}.`);
      return previous;
    }
    const data = await res.json();
    const names = (data.attachments || []).map((attachment) => attachment.filename);
    const match = names.map((name) => name.match(STATE_PATTERN)).find(Boolean);
    if (!match) {
      console.log(`No state attachment on message ${messageId} (attachments: ${names.join(', ') || 'none'}).`);
      return previous;
    }
    for (const entry of match[1].split('_')) {
      const [key, minutes] = entry.split('.');
      if (key && minutes) previous.set(key, parseInt(minutes, 36) * 60);
    }
    console.log(`Restored start times for ${previous.size} server(s) from message ${messageId}.`);
  } catch (err) {
    console.error(`Could not read previous message ${messageId} (${err.message}).`);
  }
  return previous;
}
export function buildStateName(entries, now) {
  const encoded = entries.map((entry) => `${entry.key}.${Math.floor(entry.since / 60).toString(36)}`).join('_') || 'none';
  return `st-${now.toString(36)}-${encoded}.png`;
}
export function formatAgo(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `~${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `~${hours} h ${rest} min ago` : `~${hours} h ago`;
}
export async function sendMessage(webhookUrl, messageId, content, embeds, files) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content,
    embeds,
    allowed_mentions: { parse: [] },
    attachments: files.map((file, index) => ({ id: index, filename: file.name })),
  }));
  files.forEach((file, index) => form.append(`files[${index}]`, new Blob([file.data]), file.name));
  return fetch(`${webhookUrl}/messages/${messageId}`, { method: 'PATCH', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}
