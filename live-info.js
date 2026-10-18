export const TOP_COUNT = 15;
const SETTING_KEYS = ['custominv', 'scenario', 'fullset', 'fullrandom', 'difficulty', 'brainy', 'wavelen', 'nonstop', 'horde', 'shortgame', 'nohorses', 'lesscav', 'oldstyle', 'breakset', 'fullboss', 'event'];
const INVASION_WORDS = {
  2: 'MordorIsengard',
  3: 'Lotr',
  4: 'Mulan',
  5: 'Isengard',
  6: 'Rome',
  7: 'Barbarian',
  9: 'Triax',
  11: 'ChaosHordes',
  12: 'Powderclan',
  13: 'Snagas',
  14: 'Snagas',
  15: 'Sith',
  16: 'Zombiee',
  17: 'Zombie',
  18: 'Orcs',
  19: 'Farmers',
  21: 'Sylvania',
  22: 'Greeks',
  23: 'Peasants',
  24: 'Nomad',
  25: 'Greenskins',
  26: 'Greenskins',
  27: 'Sigmar',
  28: 'Dunland',
};
const SCENARIO_DEFENDERS = { 2: 'The Gamblers', 10: 'The Jedi Council', 11: 'The Last Survivors' };
const FULL_SETS = ['default', 'lotr', 'evil', 'humans', 'two towers', 'no chaos'];
const DIFFICULTIES = {
  1: ['Normal', 'normal'],
  2: ['Hard', 'hard'],
  3: ['Very hard', 'hard'],
  4: ['Challenge', 'extreme'],
  5: ['Risky', 'extreme'],
  6: ['Easy', 'easy'],
  7: ['Semirisky', 'extreme'],
  8: ['Riskychallenge', 'extreme'],
};
const WAVE_LENGTHS = { 0: 'Custom', 2: 'x1.5', 3: 'x2', 4: 'x3' };
const RESPAWNS = { 1: '1 per wave', 2: 'Hardcore', 3: 'Unlimited', 4: 'After boss' };
const BREAKS = { 0: 'Disabled', 1: 'Short', 3: 'Custom' };
const NONSTOPS = { 1: 'Half', 2: 'Yes', 3: 'Mega', 4: 'Half', 5: 'Yes' };
const HORDES = { 1: 'On', 2: 'Mega' };
export function parseSettings(data) {
  const settings = {};
  for (const key of SETTING_KEYS) {
    const raw = data[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) settings[key] = value;
  }
  return settings;
}
export function describeLive(live) {
  const s = live.settings || {};
  const invaders = { text: live.invaders || '?', suffix: '' };
  const word = INVASION_WORDS[s.custominv];
  if (word) {
    invaders.text = `Invasion of ${word}`;
  } else if (/full.*invasion/i.test(live.invaders || '') && s.fullset > 0 && FULL_SETS[s.fullset]) {
    invaders.suffix = FULL_SETS[s.fullset];
  }
  let difficulty = null;
  if (s.brainy !== undefined && s.brainy !== 0) {
    difficulty = { text: 'Hardbots', tone: 'extreme' };
  } else if (s.difficulty !== undefined) {
    const known = DIFFICULTIES[s.difficulty];
    difficulty = known ? { text: known[0], tone: known[1] } : { text: 'Custom', tone: 'custom' };
  }
  const polls = [];
  const add = (label, value) => {
    if (value) polls.push({ label, value });
  };
  add('Respawn', RESPAWNS[s.oldstyle]);
  if (s.nohorses === 1) add('Cavalry', 'Disabled');
  else if (s.lesscav !== undefined && s.lesscav !== 0) add('Cavalry', 'Reduced');
  const nonstop = NONSTOPS[s.nonstop];
  add('Nonstop', nonstop);
  if (s.wavelen !== undefined && s.wavelen !== 1) add('Wave length', WAVE_LENGTHS[s.wavelen] || 'Custom');
  if (s.horde !== undefined && s.horde !== 0) add('Horde', HORDES[s.horde] || 'Custom');
  if (s.shortgame === 1) add('Short Game', 'Yes');
  if (s.fullboss === 1) add('Full Boss', 'Yes');
  if (s.fullrandom === 1) add('Full Faction', 'Yes');
  if (!nonstop) add('Breaks', BREAKS[s.breakset]);
  return {
    defenders: { text: SCENARIO_DEFENDERS[s.scenario] || live.defenders || '?', suffix: '' },
    invaders,
    difficulty,
    polls,
    hasSettings: Object.keys(s).length > 0,
  };
}
