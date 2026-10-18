import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOP_COUNT, describeLive } from './live-info.js';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const fontFile = (pkg, weight, file) => join(ROOT, 'node_modules', '@expo-google-fonts', pkg, weight, file);
GlobalFonts.registerFromPath(fontFile('cinzel', '700Bold', 'Cinzel_700Bold.ttf'), 'MMCinzel');
GlobalFonts.registerFromPath(fontFile('spectral', '400Regular', 'Spectral_400Regular.ttf'), 'MMBody');
GlobalFonts.registerFromPath(fontFile('spectral', '600SemiBold', 'Spectral_600SemiBold.ttf'), 'MMBodyBold');
GlobalFonts.registerFromPath(fontFile('libre-baskerville', '700Bold', 'LibreBaskerville_700Bold.ttf'), 'MMMap');
const SHOW_SIGNATURE = true;
const SIGNATURE_H = 18;
const SCALE = 2;
const W = 960;
const PAD = 20;
const CARD_PAD = 20;
const CARD_GAP = 32;
const PREVIEW_W = 380;
const PREVIEW_H = 240;
const TEXT_GAP = 32;
const LIVE_GAP = 18;
const LIVE_COLS = 3;
const LIVE_ROWS = Math.ceil(TOP_COUNT / LIVE_COLS);
const LIVE_ROW = 29;
const LIVE_ROW_H = 25;
const LIVE_TOP = 62;
const LIVE_BOTTOM = 20;
const LIVE_PANEL_H = LIVE_TOP + (LIVE_ROWS - 1) * LIVE_ROW + LIVE_ROW_H + LIVE_BOTTOM;
const EMPTY_H = 120;
const TITLE = '#f0d48f';
const ACCENT = '#dcc07c';
const WHITE = '#f1f3f8';
const GREY = '#949bb0';
const GREEN = '#43b581';
const IDLE = '#747f8d';
const KILLS = '#d6c28a';
const DEFENDERS = '#9cc5f5';
const INVADERS = '#f0a0a2';
const LABEL = '#a3abbd';
const EMPTY_VIEW = { defenders: { text: 'Defenders', suffix: '' }, invaders: { text: 'Invaders', suffix: '' }, difficulty: null, polls: [], hasSettings: false };
const EMPTY_LIVE = { players: [] };
const TONES = { easy: '#a6dcb4', normal: '#f1f3f8', hard: '#f5a35c', extreme: '#f0a0a2', custom: '#c9b8f0' };
export function mapSlug(map) {
  const slug = String(map || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'map';
}
function tokens(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export function resolveMapImage(mapsDir, map) {
  let files = [];
  try {
    files = readdirSync(mapsDir);
  } catch {
    return null;
  }
  const images = files
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => ({ file: f, stem: f.replace(/\.[^.]+$/, '').toLowerCase() }));
  const names = [mapSlug(map), mapSlug(baseMapName(map))];
  for (const name of names) {
    const exact = images.find((i) => i.stem === name) || images.find((i) => i.stem !== 'default' && i.stem.replace(/[^a-z0-9]/g, '') === name.replace(/_/g, ''));
    if (exact) return join(mapsDir, exact.file);
  }
  const variants = [tokens(map), tokens(baseMapName(map))].filter((t) => t.length > 0);
  let best = null;
  let bestScore = 0;
  for (const image of images) {
    if (image.stem === 'default') continue;
    const it = tokens(image.stem);
    if (it.length === 0) continue;
    for (const mt of variants) {
      const overlap = it.filter((t) => mt.includes(t)).length;
      let score = overlap / Math.max(it.length, mt.length);
      if (it[0] === mt[0] && mt[0].length >= 4) score = Math.max(score, 0.5);
      if (score > bestScore) {
        best = image;
        bestScore = score;
      }
    }
  }
  if (best && bestScore >= 0.5) return join(mapsDir, best.file);
  const fallback = images.find((i) => i.stem === 'default');
  return fallback ? join(mapsDir, fallback.file) : null;
}
export function baseMapName(map) {
  const text = String(map || 'unknown');
  const cut = text.indexOf('(');
  const head = cut > 0 ? text.slice(0, cut) : text;
  const clean = head.replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/[\s\-–:]+$/, '').trim();
  return clean || text.replace(/_/g, ' ').trim();
}
function mixColor(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
function playersColor(n) {
  if (n <= 0) return '#9aa0ad';
  const t = Math.min(1, Math.log(n) / Math.log(30));
  return mixColor('#bbf7d0', '#22c55e', t);
}
function formatAgo(seconds) {
  if (seconds < 60) return 'just now';
  return `~${Math.floor(seconds / 60)} min ago`;
}
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function drawSpaced(ctx, text, x, y, spacing, align = 'left') {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(chars.length - 1, 0);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  return total;
}
function fitFont(ctx, text, family, size, min, maxWidth) {
  let s = size;
  ctx.font = `${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = `${s}px ${family}`;
  }
  return s;
}
function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function drawCorners(ctx, w, h) {
  const m = 6;
  const l = 18;
  ctx.strokeStyle = 'rgba(201,164,92,0.4)';
  ctx.lineWidth = 1.5;
  [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * l);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * l, y);
    ctx.stroke();
  });
}
function drawBackground(ctx, w, h) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#15141f');
  base.addColorStop(0.5, '#192038');
  base.addColorStop(1, '#2a2036');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(70, -10, 0, 70, -10, 340);
  glow.addColorStop(0, 'rgba(226,178,90,0.11)');
  glow.addColorStop(1, 'rgba(226,178,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const cool = ctx.createRadialGradient(w, h, 0, w, h, 620);
  cool.addColorStop(0, 'rgba(90,120,220,0.13)');
  cool.addColorStop(1, 'rgba(90,120,220,0)');
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  [[0.06, 0.022], [0.2, 0.016], [0.34, 0.012]].forEach(([start, alpha]) => {
    const beam = ctx.createLinearGradient(0, 0, w, h);
    beam.addColorStop(0, `rgba(255,236,190,${alpha})`);
    beam.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(w * start, 0);
    ctx.lineTo(w * (start + 0.07), 0);
    ctx.lineTo(w * (start + 0.07) + h * 0.9, h);
    ctx.lineTo(w * start + h * 0.9, h);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
  const rand = seeded(42);
  for (let i = 0; i < 22; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 6 + rand() * 18;
    const dust = ctx.createRadialGradient(x, y, 0, x, y, r);
    dust.addColorStop(0, `rgba(240,215,150,${0.022 + rand() * 0.032})`);
    dust.addColorStop(1, 'rgba(240,215,150,0)');
    ctx.fillStyle = dust;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  roundedRect(ctx, 0.5, 0.5, w - 1, h - 1, 12);
  ctx.strokeStyle = 'rgba(201,164,92,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  drawCorners(ctx, w, h);
}
function drawPlaceholder(ctx, x, y, w, h) {
  const sky = ctx.createLinearGradient(x, y, x, y + h);
  sky.addColorStop(0, '#2a3248');
  sky.addColorStop(1, '#161b2b');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + h * 0.62);
  ctx.lineTo(x + w * 0.2, y + h * 0.42);
  ctx.lineTo(x + w * 0.36, y + h * 0.6);
  ctx.lineTo(x + w * 0.55, y + h * 0.3);
  ctx.lineTo(x + w * 0.78, y + h * 0.58);
  ctx.lineTo(x + w * 0.9, y + h * 0.48);
  ctx.lineTo(x + w, y + h * 0.62);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = '12px MMBodyBold';
  drawSpaced(ctx, 'NO PREVIEW IMAGE', x + w / 2, y + h * 0.5, 3, 'center');
}
async function drawPreview(ctx, card, x, y, w, h, mapsDir) {
  ctx.save();
  roundedRect(ctx, x, y, w, h, 12);
  ctx.clip();
  const file = resolveMapImage(mapsDir, card.map);
  let drawn = false;
  if (file) {
    try {
      const img = await loadImage(file);
      const scale = Math.max(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      drawn = true;
    } catch {
      drawn = false;
    }
  }
  if (!drawn) drawPlaceholder(ctx, x, y, w, h);
  ctx.restore();
  roundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 12);
  ctx.strokeStyle = 'rgba(201,164,92,0.5)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const status = card.players > 0 ? { text: 'ONLINE', color: GREEN } : { text: 'EMPTY', color: IDLE };
  ctx.font = '12px MMBodyBold';
  const textWidth = [...status.text].reduce((a, c) => a + ctx.measureText(c).width + 2, 0) - 2;
  roundedRect(ctx, x + 12, y + 12, textWidth + 42, 26, 13);
  ctx.fillStyle = 'rgba(15,17,21,0.82)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 12 + 15, y + 12 + 13, 5, 0, Math.PI * 2);
  ctx.fillStyle = status.color;
  ctx.fill();
  ctx.fillStyle = WHITE;
  drawSpaced(ctx, status.text, x + 12 + 28, y + 12 + 17, 2);
  if (card.live && card.live.settings && card.live.settings.event === 1) {
    ctx.font = '12px MMBodyBold';
    const eventWidth = [...'EVENT'].reduce((a, c) => a + ctx.measureText(c).width + 2, 0) - 2;
    const pillW = eventWidth + 28;
    roundedRect(ctx, x + w - 12 - pillW, y + 12, pillW, 26, 13);
    ctx.fillStyle = 'rgba(15,17,21,0.82)';
    ctx.fill();
    ctx.fillStyle = '#ff4d4d';
    drawSpaced(ctx, 'EVENT', x + w - 12 - pillW + 14, y + 12 + 17, 2);
  }
}
function drawLabel(ctx, text, x, y, align = 'left', size = 12) {
  ctx.fillStyle = LABEL;
  ctx.font = `${size}px MMBodyBold`;
  drawSpaced(ctx, text, x, y, 2.2, align);
}
function cardHeight(card) {
  return CARD_PAD * 2 + PREVIEW_H + LIVE_GAP + LIVE_PANEL_H;
}
function spacedWidth(ctx, text, spacing) {
  const chars = [...text];
  return chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + spacing * Math.max(chars.length - 1, 0);
}
function factionLayout(ctx, label, size) {
  const main = String(label.text || '?').toUpperCase();
  const suffix = label.suffix ? `(${String(label.suffix).toUpperCase()})` : '';
  const gap = suffix ? 10 : 0;
  const subSize = Math.max(10, Math.round(size * 0.6));
  ctx.font = `${size}px MMCinzel`;
  const mainW = spacedWidth(ctx, main, 1.5);
  ctx.font = `${subSize}px MMBodyBold`;
  const subW = suffix ? spacedWidth(ctx, suffix, 1.2) : 0;
  return { main, suffix, gap, subSize, mainW, total: mainW + gap + subW };
}
function factionSize(ctx, a, b, maxWidth) {
  let size = 21;
  while (size > 11 && (factionLayout(ctx, a, size).total > maxWidth || factionLayout(ctx, b, size).total > maxWidth)) size -= 1;
  return size;
}
function drawFaction(ctx, label, color, x, y, align, size) {
  const l = factionLayout(ctx, label, size);
  const start = align === 'right' ? x - l.total : align === 'center' ? x - l.total / 2 : x;
  ctx.fillStyle = color;
  ctx.font = `${size}px MMCinzel`;
  drawSpaced(ctx, l.main, start, y, 1.5);
  if (l.suffix) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.font = `${l.subSize}px MMBodyBold`;
    drawSpaced(ctx, l.suffix, start + l.mainW + l.gap, y, 1.2);
    ctx.restore();
  }
}
function killsText(kills) {
  return `(${kills} ${kills === 1 ? 'kill' : 'kills'})`;
}
function drawLive(ctx, live, view, px, y, w) {
  roundedRect(ctx, px + 0.5, y + 0.5, w - 1, LIVE_PANEL_H - 1, 14);
  ctx.fillStyle = 'rgba(8,10,20,0.34)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(201,164,92,0.24)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const mid = px + w / 2;
  const room = w / 2 - 56;
  const fsize = factionSize(ctx, view.defenders, view.invaders, room);
  const defW = factionLayout(ctx, view.defenders, fsize).total;
  const invW = factionLayout(ctx, view.invaders, fsize).total;
  ctx.font = '12px MMBodyBold';
  const vsW = spacedWidth(ctx, 'VS', 2);
  const vsGap = 18;
  const startX = mid - (defW + vsGap + vsW + vsGap + invW) / 2;
  drawFaction(ctx, view.defenders, DEFENDERS, startX, y + 38, 'left', fsize);
  ctx.font = '12px MMBodyBold';
  ctx.fillStyle = GREY;
  drawSpaced(ctx, 'VS', startX + defW + vsGap, y + 37, 2);
  drawFaction(ctx, view.invaders, INVADERS, startX + defW + vsGap + vsW + vsGap, y + 38, 'left', fsize);
  const left = px + 16;
  const colGap = 12;
  const colW = (w - 32 - colGap * (LIVE_COLS - 1)) / LIVE_COLS;
  const rows = Array.from({ length: TOP_COUNT }, (_, i) => live.players[i] || null);
  rows.forEach((p, i) => {
    const rx = left + Math.floor(i / LIVE_ROWS) * (colW + colGap);
    const rt = y + LIVE_TOP + (i % LIVE_ROWS) * LIVE_ROW;
    const base = rt + 18;
    roundedRect(ctx, rx, rt, colW, LIVE_ROW_H, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = '12px MMBodyBold';
    ctx.fillStyle = p ? GREY : 'rgba(148,155,176,0.5)';
    ctx.fillText(`#${i + 1}`, rx + 10, base);
    const nameX = rx + 36;
    if (!p) {
      ctx.font = '16px MMBody';
      ctx.fillText('–', nameX, base);
      return;
    }
    const kills = killsText(p.kills);
    ctx.font = '14px MMBodyBold';
    const killsW = ctx.measureText(kills).width;
    const nameRoom = colW - 36 - killsW - 6 - 8;
    fitFont(ctx, p.name, 'MMBody', 16, 12, nameRoom);
    const name = ellipsize(ctx, p.name, nameRoom);
    ctx.fillStyle = WHITE;
    ctx.fillText(name, nameX, base);
    const nameW = ctx.measureText(name).width;
    ctx.font = '14px MMBodyBold';
    ctx.fillStyle = KILLS;
    ctx.fillText(kills, nameX + nameW + 6, base);
  });
}
function drawSettings(ctx, view, x, y, w) {
  drawLabel(ctx, 'DIFFICULTY', x, y + 104);
  if (view.difficulty) {
    const text = view.difficulty.text.toUpperCase();
    const spacing = 1.2;
    fitFont(ctx, text, 'MMCinzel', 19, 11, w - spacing * Math.max([...text].length - 1, 0));
    ctx.fillStyle = TONES[view.difficulty.tone] || WHITE;
    drawSpaced(ctx, text, x, y + 132, spacing);
  } else {
    ctx.fillStyle = GREY;
    ctx.font = '19px MMBodyBold';
    ctx.fillText('—', x, y + 132);
  }
}
function drawPair(ctx, label, value, x, y, maxWidth, size) {
  const head = `${label}  `;
  let s = size;
  let headW = 0;
  let valueW = 0;
  for (;;) {
    ctx.font = `${s}px MMBody`;
    headW = ctx.measureText(head).width;
    ctx.font = `${s}px MMBodyBold`;
    valueW = ctx.measureText(value).width;
    if (headW + valueW <= maxWidth || s <= 9) break;
    s -= 0.5;
  }
  ctx.font = `${s}px MMBody`;
  ctx.fillStyle = LABEL;
  ctx.fillText(head, x, y);
  ctx.font = `${s}px MMBodyBold`;
  ctx.fillStyle = WHITE;
  ctx.fillText(value, x + headW, y);
  return headW + valueW;
}
function drawPolls(ctx, view, x, y, w) {
  const polls = view.polls;
  drawLabel(ctx, 'POLLS', x, y + 160);
  ctx.textAlign = 'left';
  const size = 13;
  const step = 17;
  const maxLines = 4;
  const first = y + 180;
  if (polls.length === 0) {
    ctx.fillStyle = GREY;
    if (view.hasSettings) {
      ctx.font = `${size}px MMBody`;
      ctx.fillText('All default', x, first);
    } else {
      ctx.font = '19px MMBodyBold';
      ctx.fillText('—', x, y + 188);
    }
    return;
  }
  const shown = polls.slice(0, maxLines);
  const hidden = polls.length - shown.length;
  let lastEnd = x;
  shown.forEach((poll, i) => {
    const base = first + i * step;
    ctx.fillStyle = 'rgba(201,164,92,0.75)';
    ctx.beginPath();
    ctx.arc(x + 2.5, base - 4.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    lastEnd = x + 9 + drawPair(ctx, poll.label, poll.value, x + 9, base, w - 9, size);
  });
  if (hidden > 0) {
    const text = `+${hidden} more`;
    ctx.font = `${size}px MMBody`;
    ctx.fillStyle = GREY;
    const moreW = ctx.measureText(text).width;
    if (lastEnd + 12 + moreW <= x + w) {
      ctx.textAlign = 'left';
      ctx.fillText(text, lastEnd + 12, first + (shown.length - 1) * step);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(text, x + w, y + 160);
      ctx.textAlign = 'left';
    }
  }
}
async function drawCard(ctx, card, y, info) {
  const x = PAD;
  const w = W - PAD * 2;
  const h = cardHeight(card);
  roundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,192,124,0.3)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const px = x + CARD_PAD;
  const py = y + CARD_PAD;
  await drawPreview(ctx, card, px, py, PREVIEW_W, PREVIEW_H, info.mapsDir);
  const x0 = px + PREVIEW_W + TEXT_GAP;
  const x1 = x + w - CARD_PAD - 4;
  const rw = x1 - x0;
  const view = card.live ? describeLive(card.live) : EMPTY_VIEW;
  const lw = Math.floor(rw * 0.5) - 8;
  const rx = x0 + lw + 16;
  ctx.textAlign = 'left';
  const count = String(card.players);
  const maxText = card.maxPlayers ? ` / ${card.maxPlayers}` : '';
  ctx.font = '34px MMCinzel';
  const countW = ctx.measureText(count).width;
  ctx.font = '18px MMBody';
  const playersW = countW + ctx.measureText(maxText).width;
  const badgeW = Math.max(playersW, 74) + 32;
  const badgeX = x1 - badgeW;
  const badge = ctx.createLinearGradient(badgeX, py, badgeX, py + 64);
  badge.addColorStop(0, 'rgba(6,8,18,0.3)');
  badge.addColorStop(1, 'rgba(6,8,18,0.14)');
  roundedRect(ctx, badgeX + 0.5, py + 0.5, badgeW - 1, 63, 12);
  ctx.fillStyle = badge;
  ctx.fill();
  ctx.strokeStyle = 'rgba(201,164,92,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const badgeMid = badgeX + badgeW / 2;
  drawLabel(ctx, 'PLAYERS', badgeMid, py + 20, 'center', 10);
  ctx.textAlign = 'left';
  ctx.fillStyle = playersColor(card.players);
  ctx.font = '34px MMCinzel';
  ctx.fillText(count, badgeMid - playersW / 2, py + 54);
  ctx.fillStyle = GREY;
  ctx.font = '18px MMBody';
  ctx.fillText(maxText, badgeMid - playersW / 2 + countW, py + 54);
  const nameRoom = rw - badgeW - 18;
  ctx.fillStyle = TITLE;
  fitFont(ctx, card.name, 'MMCinzel', 30, 16, nameRoom);
  ctx.fillText(ellipsize(ctx, card.name, nameRoom), x0, py + 34);
  ctx.fillStyle = 'rgba(163,171,189,0.6)';
  ctx.font = '11px MMBodyBold';
  const sub = [card.gameType, card.region].filter((v) => v && v !== 'N/A').join('  ·  ').toUpperCase();
  drawSpaced(ctx, sub || 'FULL INVASION OSIRIS', x0 + 1, py + 60, 2.2);
  ctx.fillStyle = 'rgba(201,164,92,0.7)';
  ctx.fillRect(x0, py + 74, rw, 1.5);
  const mapName = baseMapName(card.map);
  drawLabel(ctx, 'CURRENT MAP', x0, py + 104);
  ctx.fillStyle = WHITE;
  fitFont(ctx, mapName, 'MMMap', 22, 12, lw);
  ctx.fillText(ellipsize(ctx, mapName, lw), x0, py + 132);
  drawLabel(ctx, 'MAP STARTED', x0, py + 160);
  ctx.textAlign = 'left';
  if (card.players > 0) {
    const ago = formatAgo(Math.max(0, info.now - card.since));
    const wave = card.live && card.live.wave > 0 ? `[Wave: ${card.live.wave}]` : '';
    ctx.font = '21px MMBodyBold';
    const waveW = wave ? ctx.measureText(wave).width + 12 : 0;
    ctx.fillStyle = WHITE;
    const agoSize = fitFont(ctx, ago, 'MMBodyBold', 24, 13, lw - waveW);
    const agoW = ctx.measureText(ago).width;
    ctx.fillText(ago, x0, py + 188);
    if (wave) {
      ctx.font = `${Math.max(11, agoSize - 3)}px MMBodyBold`;
      ctx.fillStyle = WHITE;
      ctx.fillText(wave, x0 + agoW + 12, py + 188);
    }
  } else {
    ctx.fillStyle = GREY;
    ctx.font = '24px MMBodyBold';
    ctx.fillText('—', x0, py + 188);
  }
  ctx.fillStyle = 'rgba(201,164,92,0.18)';
  ctx.fillRect(x0 + lw + 7.5, py + 92, 1, 142);
  drawSettings(ctx, view, rx, py, x1 - rx);
  drawPolls(ctx, view, rx, py, x1 - rx);
  drawLive(ctx, card.live || EMPTY_LIVE, view, px, py + PREVIEW_H + LIVE_GAP, w - CARD_PAD * 2);
}
function drawEmpty(ctx, y, keyword) {
  const w = W - PAD * 2;
  roundedRect(ctx, PAD + 0.5, y + 0.5, w - 1, EMPTY_H - 1, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,192,124,0.3)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.font = '26px MMBodyBold';
  ctx.textAlign = 'center';
  ctx.fillText(`No ${keyword} server`, W / 2, y + 72);
}
export async function renderMonitor({ cards, now, mapsDir, keyword }) {
  const bodyH = cards.length === 0 ? EMPTY_H : cards.reduce((sum, c) => sum + cardHeight(c), 0) + (cards.length - 1) * CARD_GAP;
  const extra = SHOW_SIGNATURE ? SIGNATURE_H : 0;
  const height = PAD + extra + bodyH + extra + PAD;
  const canvas = createCanvas(W * SCALE, height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  drawBackground(ctx, W, height);
  let y = PAD + extra;
  if (cards.length === 0) drawEmpty(ctx, y, keyword);
  for (const card of cards) {
    await drawCard(ctx, card, y, { mapsDir, now });
    y += cardHeight(card) + CARD_GAP;
  }
  if (SHOW_SIGNATURE) {
    ctx.fillStyle = 'rgba(200,214,240,0.5)';
    ctx.font = '11px MMCinzel';
    drawSpaced(ctx, 'MELODIA SERVER MONITOR', W - PAD - 6, PAD + extra + bodyH + 20, 2.6, 'right');
  }
  return canvas.toBuffer('image/png');
}
