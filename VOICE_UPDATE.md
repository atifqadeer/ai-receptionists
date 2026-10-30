# Voice Configuration Update

## Overview
Updated the AI Receptionist voice system to use 6 distinct, named voices instead of generic identifiers.

## New Voice Options

### Available Voices

| Voice | Gender | Accent | Characteristics | ElevenLabs ID |
|-------|--------|--------|-----------------|---------------|
| **Skylar** | Female | American | Warm, friendly, approachable | EXAVITQu4vr4xnSDxMaL |
| **Daniel** | Male | British | Deep, authoritative, professional | onwK4e9ZLuTAKqWW03F9 |
| **Gemma** | Female | Irish | Soft, gentle, calm | pFZP5JQG7iQjIQuC4Bku |
| **Parker** | Male | American | Clear, confident, energetic | OXyPsHkaYpLrZFlUdLVd |
| **Archie** | Male | British | Young, upbeat, cheerful | XrC1iQiEwGHWoAojsVZF |
| **Jacqueline** | Female | American | Elegant, sophisticated, polished | sGyzj8KtGHWoAojsVZF |

## Changes Made

### Frontend (React)
1. **VoicePreview.tsx** - Complete rewrite with:
   - 6 distinct voice cards with unique colors and avatars
   - Each voice has its own sample text
   - Browser TTS tuning (rate/pitch) for differentiation
   - Visual tags showing voice characteristics
   - ElevenLabs voice IDs displayed

2. **SetupForm.tsx** - Updated default voice from `female-1` to `skylar`

### Backend (Python)
1. **app/models/schemas.py** - Updated AgentConfig default voice to `skylar`
2. **app/services/ai_agent.py** - Updated default voice to `skylar`
3. **src/utils/pythonFiles.ts** - Updated downloadable ZIP to use new voice IDs

## Voice Differentiation

Each voice uses unique browser TTS settings to sound distinct:

```typescript
Skylar:      rate: 1.0,   pitch: 1.15  (warm, slightly higher)
Daniel:      rate: 0.95,  pitch: 0.85  (deep, slower)
Gemma:       rate: 0.95,  pitch: 1.2   (soft, gentle)
Parker:      rate: 1.05,  pitch: 0.95  (energetic, clear)
Archie:      rate: 1.05,  pitch: 1.1   (young, upbeat)
Jacqueline:  rate: 0.98,  pitch: 1.05  (elegant, refined)
```

## Production Usage

For production with authentic voice quality:

1. **ElevenLabs Integration** (Settings → Integrations)
   - Add your ElevenLabs API key
   - Select voice provider: ElevenLabs
   - Each voice ID maps to real ElevenLabs voices

2. **Cartesia Integration** (Alternative)
   - Add your Cartesia API key
   - Select voice provider: Cartesia
   - Lower latency for real-time calls

## Testing

To test the voices:
1. Go to **Agent Setup** → **Identity & Voice** tab
2. Scroll to **Voice Preview** section
3. Click the **Preview** button on any voice card
4. Each voice will speak its unique sample text
5. Adjust **Speaking Rate** and **Pitch** sliders to fine-tune

## Notes

- Browser preview uses Web Speech API with pitch/rate tuning
- For production, connect ElevenLabs or Cartesia API
- Voice IDs are compatible with ElevenLabs voice library
- Each voice has distinct personality traits and sample text
