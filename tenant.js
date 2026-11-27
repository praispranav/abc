// Settings that make one bot process serve one client. Without these env vars the app behaves as a single install.
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegram } from 'telegraf';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

export const IS_TENANT = !!process.env.TENANT_DIR;
export const ROOT = process.env.TENANT_DIR || APP_DIR; // config.json, data/ and assets/ live here

const TEMPLATE_HANDLES = ['avniffanbasebot', 'avnifanbbot', 'avnifanbasepaybot', 'avnifanbaseprembot', 'botalertsafmbot'];
export const botUsername = (n) => process.env[`BOT${n}_USERNAME`] || TEMPLATE_HANDLES[n - 1];

// Swap the template handles and brand name for this client's own
export function brandText(text) {
  if (!IS_TENANT) return text;
  let out = text;
  TEMPLATE_HANDLES.forEach((handle, i) => { out = out.replace(new RegExp(handle, 'gi'), () => botUsername(i + 1)); });
  const business = process.env.BUSINESS_NAME;
  if (business) out = out.replace(/Avni ?Fan ?[Bb]ase(™|TM)?/g, () => business);
  return out;
}

function mapStrings(value, change, key) {
  if (key === 'source') return value; // file paths and buffers
  if (typeof value === 'string') return change(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, change));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, change, k)]));
  }
  return value;
}

export const brandDeep = (value) => mapStrings(value, brandText);

// Saved settings keep the template handles, so replacing a bot later updates every link
export function unbrandDeep(value) {
  const pairs = TEMPLATE_HANDLES.map((handle, i) => [botUsername(i + 1), handle])
    .sort((a, b) => b[0].length - a[0].length);
  return mapStrings(value, (text) => pairs.reduce((out, [own, handle]) => out.replaceAll(own, handle), text));
}

// Patched on the prototype because Telegraf creates a new Telegram object for every update
if (IS_TENANT) {
  const callApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = function (method, data, options) {
    return callApi.call(this, method, brandDeep(data), options);
  };
}

// A client must not point a media field at files outside their own folder
export function findUnsafePath(value, key = '') {
  if (typeof value === 'string') {
    const unsafe = /path$/i.test(key) && value && (path.isAbsolute(value) || value.split(/[\\/]/).includes('..'));
    return unsafe ? key : null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = findUnsafePath(v, Array.isArray(value) ? key : k);
      if (found) return found;
    }
  }
  return null;
}
