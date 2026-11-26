# Agent promo video (Hindi, 9:16, about 45 s)

HyperFrames video with ElevenLabs Hindi narration. Separate from the bot code.

## First time

Needs Node 22+ and FFmpeg.

```bash
npm install
cp .env.example .env     # then put ELEVENLABS_API_KEY in .env (git-ignored)
npm run voices           # optional: pick a voice, set ELEVENLABS_VOICE_ID in .env
npm run video            # makes the narration, then renders renders/promo.mp4
```

## After changing the script

1. Edit `script.json`.
2. Run `npm run video`.

| To change | Edit in `script.json` |
|---|---|
| Brand name and support contacts (**placeholders now**) | `brand` |
| What is spoken (captions follow it) | `scenes[].narration` |
| Headings and the sample chat | `scenes[].title`, `scenes[].chat` |
| When something appears | `scenes[].cues`: each value must be a word or phrase from that scene's narration |
| Voice and model | `voice` (`eleven_v4`; `eleven_multilingual_v2` also works) |

Only scenes whose narration, voice or model changed are sent to ElevenLabs again. To force a new take, delete that scene's files in `audio/`.

If you change only text on screen, `npm run render` is enough and uses no credits.

Video length follows the narration. The build warns above 50 s.

## Other commands

- `npm run draft`: preview with the macOS Hindi voice (`Lekha`), no key needed. Not for publishing. Run `npm run audio` afterwards to switch back.
- `npm run check`: HyperFrames lint, layout, Reels safe area and contrast checks.

Colours and layout are in `src/template.html`; scene visuals in `src/scenes.mjs`.

## Before publishing

- Replace the placeholder brand and contacts.
- The video says WhatsApp Business, Instagram and Telegram share one source of truth. Publish that only once your product does it.
- The chat is a made-up example, not a real customer conversation.
