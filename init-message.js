const WEBHOOK_URL = process.argv[2] || process.env.DISCORD_WEBHOOK_URL;
const SECRET_NAME = process.argv[3] || 'DISCORD_MESSAGE_ID';
if (!WEBHOOK_URL) {
  console.error('Usage: node init-message.js <WEBHOOK_URL> [SECRET_NAME]');
  process.exit(1);
}
const res = await fetch(`${WEBHOOK_URL}?wait=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    embeds: [
      {
        title: 'Melodia Server Monitor',
        description: 'Initializing... the first update will replace this message.',
        color: 0xd4af37,
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
console.log(`Save this as the ${SECRET_NAME} repo secret (Settings -> Secrets and variables -> Actions):`);
console.log(data.id);
