// Turns script.json + the narration clips into index.html (the HyperFrames composition).
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { at, readScript } from './common.mjs';
import { scenes as renderers } from './scenes.mjs';

if (!existsSync(at('audio/manifest.json'))) {
  console.error('No narration yet. Run "npm run audio" first.');
  process.exit(1);
}
const script = readScript();
const manifest = JSON.parse(readFileSync(at('audio/manifest.json'), 'utf8'));

mkdirSync(at('vendor'), { recursive: true });
copyFileSync(at('node_modules/gsap/dist/gsap.min.js'), at('vendor/gsap.min.js'));
const fonts = [];
for (const subset of ['devanagari', 'latin', 'latin-ext']) {
  for (const weight of [500, 800]) {
    const name = `noto-sans-devanagari-${subset}-${weight}-normal.woff2`;
    copyFileSync(at('node_modules/@fontsource/noto-sans-devanagari/files', name), at('vendor', name));
    const range = {
      devanagari: 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+25CC,U+A830-A839,U+A8E0-A8FF',
      latin: 'U+0000-00FF,U+2000-206F,U+2122,U+2192',
      'latin-ext': 'U+0100-02AF,U+20A0-20C0',
    }[subset];
    fonts.push(`@font-face{font-family:"Promo Sans";src:url("vendor/${name}") format("woff2");font-weight:${weight};unicode-range:${range};}`);
  }
}

const LEAD = 0.25; // silence before each line
const TAIL = 0.35; // breathing room after it
const END_HOLD = 2.0; // keep the contact card on screen
const r = (n) => Math.round(n * 1000) / 1000;

// Seconds into a clip at which character `i` is spoken.
const timeOfChar = (clip, i) => {
  const a = clip.alignment;
  if (a && a.character_start_times_seconds.length) {
    const n = a.character_start_times_seconds.length;
    return a.character_start_times_seconds[Math.min(n - 1, Math.round((i / clip.text.length) * n))];
  }
  return (i / clip.text.length) * clip.duration; // no timestamps: estimate
};

// Split narration into short caption phrases at punctuation, then by length.
function phrases(text) {
  const out = [];
  let start = 0;
  let line = '';
  for (const m of text.matchAll(/\S+/g)) {
    if (!line) start = m.index;
    line = line ? `${line} ${m[0]}` : m[0];
    if (/[।?!]$/.test(m[0]) || (/,$/.test(m[0]) && line.length > 14) || line.length > 30) {
      out.push({ line, start });
      line = '';
    }
  }
  if (line) out.push({ line, start });
  // A one or two word caption flashes by too fast, so join it to its neighbour.
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].line.split(' ').length <= 2 && `${out[i - 1].line} ${out[i].line}`.length <= 46) {
      out[i - 1].line += ` ${out[i].line}`;
      out.splice(i, 1);
    }
  }
  return out;
}

let t = 0;
const html = [];
const audio = [];
const captions = [];
const anims = [];

script.scenes.forEach((scene, index) => {
  const clip = manifest.scenes[scene.id];
  if (!clip || clip.text !== scene.narration) {
    console.error(`Narration for "${scene.id}" is out of date. Run "npm run audio" again.`);
    process.exit(1);
  }
  const last = index === script.scenes.length - 1;
  const start = r(t);
  const voiceAt = r(start + LEAD);
  const length = r(LEAD + clip.duration + TAIL + (scene.hold ?? 0) + (last ? END_HOLD : 0));

  const cue = (name) => {
    const word = scene.cues[name];
    const i = scene.narration.indexOf(word);
    if (i < 0) console.warn(`Cue "${name}" (${word}) is not in the "${scene.id}" narration.`);
    return r(voiceAt + timeOfChar(clip, Math.max(0, i)));
  };
  const show = (selector, time, from = { y: 50, scale: 0.94 }) =>
    anims.push(
      `tl.fromTo(${JSON.stringify(selector)},${JSON.stringify({ opacity: 0, ...from })},` +
        `{opacity:1,x:0,y:0,scale:1,duration:0.45,ease:"back.out(1.5)"},${r(time)});`,
    );

  show(`#${scene.id} .title`, start + 0.05, { y: 40 });
  const body = renderers[scene.type]({ scene, brand: script.brand, cue, show, start, anims });
  const title = scene.title.split('\n').map((l) => `<span>${l}</span>`).join('');
  html.push(
    `<section id="${scene.id}" class="clip scene" data-start="${start}" data-duration="${length}" data-track-index="0">` +
      `<h1 class="title">${title}</h1>${body}</section>`,
  );
  audio.push(
    `<audio id="vo-${scene.id}" src="${clip.file}" data-start="${voiceAt}" data-duration="${r(clip.duration)}" data-track-index="2" data-volume="1"></audio>`,
  );

  const parts = phrases(scene.narration);
  parts.forEach((p, i) => {
    const from = r(voiceAt + timeOfChar(clip, p.start));
    const to = i + 1 < parts.length ? r(voiceAt + timeOfChar(clip, parts[i + 1].start)) : r(voiceAt + clip.duration + 0.2);
    captions.push(
      `<div id="cap-${scene.id}-${i}" class="clip caption" data-start="${from}" data-duration="${r(to - from - 0.001)}" data-track-index="1"><span>${p.line}</span></div>`,
    );
  });
  t = start + length;
});

const total = r(t);
const page = readFileSync(at('src/template.html'), 'utf8')
  .replace('/*FONTS*/', fonts.join('\n'))
  .replaceAll('__TOTAL__', String(total))
  .replace('__BRAND__', script.brand.name)
  .replace('<!--SCENES-->', [...html, ...captions, ...audio].join('\n'))
  .replace('/*ANIMS*/', anims.join('\n'));
writeFileSync(at('index.html'), page);
console.log(`index.html built: ${total}s${manifest.placeholder ? ' (PLACEHOLDER voice)' : ''}`);
if (total > 50) console.warn('Longer than the 45s target: shorten the narration in script.json.');
