// One narration clip per scene. Unchanged scenes are reused, so edits only cost
// credits for the lines you changed.
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { at, readScript, loadEnv, apiKey } from './common.mjs';

const placeholder = process.argv.includes('--placeholder');
loadEnv();
const script = readScript();
const model = script.voice.model;
const voiceId = process.env.ELEVENLABS_VOICE_ID || script.voice.voiceId;
const key = placeholder ? null : apiKey();
mkdirSync(at('audio'), { recursive: true });

const duration = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

// eleven_v3 / eleven_v4 use the Text to Dialogue API; older models use Text to Speech.
async function elevenlabs(text) {
  const dialogue = /^eleven_v[34]/.test(model);
  const url = dialogue
    ? 'https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps'
    : `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const body = dialogue
    ? { model_id: model, language_code: 'hi', inputs: [{ text, voice_id: voiceId }] }
    : { model_id: model, text };
  const res = await fetch(`${url}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `ElevenLabs ${res.status} for model ${model}: ${await res.text()}\n` +
        'If the model is the problem, set voice.model to "eleven_multilingual_v2" in script.json.',
    );
  }
  return res.json();
}

const manifest = { placeholder, scenes: {} };
for (const scene of script.scenes) {
  const text = scene.narration;
  const tag = placeholder ? 'placeholder' : `${model}|${voiceId}`;
  const hash = createHash('sha1').update(`${tag}|${text}`).digest('hex').slice(0, 10);
  const mp3 = `audio/${scene.id}-${hash}.mp3`;
  const meta = at(`audio/${scene.id}-${hash}.json`);

  if (!existsSync(at(mp3)) || !existsSync(meta)) {
    let alignment = null;
    if (placeholder) {
      // macOS Hindi system voice, only for previewing layout before a key is set.
      const aiff = at(`audio/${scene.id}.aiff`);
      execFileSync('say', ['-v', 'Lekha', '-o', aiff, text]);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-b:a', '128k', at(mp3)]);
      rmSync(aiff);
    } else {
      console.log(`Generating ${scene.id}...`);
      const out = await elevenlabs(text);
      writeFileSync(at(mp3), Buffer.from(out.audio_base64, 'base64'));
      alignment = out.alignment ?? out.normalized_alignment ?? null;
    }
    writeFileSync(meta, JSON.stringify({ alignment }));
  }
  manifest.scenes[scene.id] = {
    file: mp3,
    text,
    duration: duration(at(mp3)),
    alignment: JSON.parse(readFileSync(meta, 'utf8')).alignment,
  };
}
writeFileSync(at('audio/manifest.json'), JSON.stringify(manifest, null, 2));
const total = Object.values(manifest.scenes).reduce((n, s) => n + s.duration, 0);
console.log(`${placeholder ? 'PLACEHOLDER' : 'ElevenLabs'} narration ready: ${total.toFixed(1)}s of speech`);
