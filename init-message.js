const WEBHOOK_URL = process.argv[2] || process.env.DISCORD_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error('Usage: node init-message.js <WEBHOOK_URL>');
  process.exit(1);
}

const res = await fetch(`${WEBHOOK_URL}?wait=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    embeds: [
      {
        title: 'Gondolin - Full Invasion 2',
        description: 'Initializing... data will appear after the first GitHub Actions run.',
        color: 0x95a5a6,
      },
    ],
  }),
});

const data = await res.json();

if (!res.ok) {
  console.error('Failed to create message:', data);
  process.exit(1);
}

console.log('Message created.');
console.log('Save this as the DISCORD_MESSAGE_ID repo secret (Settings -> Secrets and variables -> Actions):');
console.log(data.id);
