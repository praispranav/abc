import { loadEnv, apiKey } from './common.mjs';

loadEnv();
const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
  headers: { 'xi-api-key': apiKey() },
});
if (!res.ok) {
  console.error(`ElevenLabs ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { voices } = await res.json();
for (const v of voices) {
  const langs = (v.verified_languages ?? []).map((l) => l.language);
  const hindi = v.labels?.language === 'hi' || langs.includes('hi') ? '[Hindi]' : '       ';
  console.log(`${hindi}  ${v.voice_id}  ${v.name}`);
}
