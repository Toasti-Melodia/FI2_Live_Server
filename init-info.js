const WEBHOOK_URL = process.argv[2] || process.env.DISCORD_INFO_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error('Usage: node init-info.js <WEBHOOK_URL>');
  console.error('   or: set DISCORD_WEBHOOK_URL / DISCORD_INFO_WEBHOOK_URL first.');
  process.exit(1);
}

const res = await fetch(`${WEBHOOK_URL}?wait=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    embeds: [
      {
        color: 0xd4af37,
        author: { name: 'Melodia Server Monitor' },
        description: 'Initializing... the first update will replace this message with the two-column server overview.',
      },
    ],
    allowed_mentions: { parse: [] },
  }),
});

const data = await res.json();
if (!res.ok) {
  console.error('Failed to create the info message:', data);
  process.exit(1);
}

console.log('Info message created.');
console.log('Save this as the DISCORD_INFO_MESSAGE_ID repository secret:');
console.log(data.id);
