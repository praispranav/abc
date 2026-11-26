import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const at = (...p) => path.join(ROOT, ...p);
export const readScript = () => JSON.parse(readFileSync(at('script.json'), 'utf8'));

// Real environment variables win over .env.
export function loadEnv() {
  if (existsSync(at('.env'))) process.loadEnvFile(at('.env'));
}

export function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error('ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add your key (or export it).');
    process.exit(1);
  }
  return key;
}
