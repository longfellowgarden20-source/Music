"""
Groq helpers for the music studio.

Two jobs:
  sounds_like(text)  -> turn "Blink-182 vibe" / any artist/song into a rich,
                        MusicGen-ready sonic prompt (genre + tempo + instruments
                        + era + mood). MusicGen can't use artist names; this
                        translates them into sound it DOES understand.
  revamp(prompt)     -> reinterpret a song's description into "our own melody":
                        same energy/instrumentation family, fresh original take.

Uses Groq (llama-3.3-70b). Key read from GROQ_API_KEY (.env.local).
Falls back gracefully if Groq is unavailable.
"""
from __future__ import annotations
import os
import httpx

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except Exception:
    pass

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"


def _key() -> str | None:
    return os.environ.get("GROQ_API_KEY")


def available() -> bool:
    return bool(_key())


def _ask(system: str, user: str, max_tokens: int = 220) -> str:
    key = _key()
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    with httpx.Client(timeout=30) as c:
        r = c.post(GROQ_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"model": MODEL, "max_tokens": max_tokens, "temperature": 0.7,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": user}]})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()


_SOUNDS_LIKE_SYS = (
    "You are a music producer who writes prompts for an instrumental music AI "
    "(MusicGen). The AI does NOT know artist or song names — only sound. "
    "Given an artist, song, or vibe, output ONE single-line prompt describing the "
    "SOUND: genre, approximate BPM, key instruments, production style, era, and mood. "
    "No vocals/lyrics references (instrumental only). No artist names in the output. "
    "Output only the prompt, nothing else.")


def sounds_like(text: str) -> str:
    """'Blink-182' -> 'fast pop-punk, 160 BPM, bright distorted power-chord guitars,
    punchy energetic drums, melodic, early-2000s skate-punk energy, upbeat'."""
    if not text.strip():
        return ""
    try:
        out = _ask(_SOUNDS_LIKE_SYS, f"Make it sound like: {text}")
        return out.strip().strip('"')
    except Exception as e:
        print(f"[groq] sounds_like failed: {e}")
        # graceful fallback: just pass the text through
        return f"{text}, instrumental"


_REVAMP_SYS = (
    "You are a producer reinterpreting a track into an original new version for an "
    "instrumental music AI (MusicGen). Keep the same energy, genre family, tempo "
    "range, and instrumentation FEEL, but describe a FRESH original melody and "
    "arrangement — not a copy. Output ONE single-line MusicGen prompt only: genre, "
    "BPM, instruments, mood, production. Instrumental only. No artist names.")


def revamp(original_prompt: str, direction: str = "") -> str:
    """Reinterpret a song's description into 'our own melody' — same vibe, new take."""
    if not original_prompt.strip():
        return ""
    user = f"Original track: {original_prompt}"
    if direction.strip():
        user += f"\nDirection for our version: {direction}"
    try:
        return _ask(_REVAMP_SYS, user).strip().strip('"')
    except Exception as e:
        print(f"[groq] revamp failed: {e}")
        return f"{original_prompt}, fresh original melody, reinterpreted"


_NOTES_SYS = (
    "You are a professional music producer giving concise, actionable feedback on a track. "
    "You receive technical analysis data and the original prompt. "
    "Return ONLY a JSON object with exactly these keys:\n"
    '  "vibe": one sentence describing the overall feel (max 15 words)\n'
    '  "strengths": array of 2 short strings — what works well\n'
    '  "suggestions": array of 3 short strings — specific production improvements\n'
    '  "next": one sentence on what to try next (a follow-up track idea)\n'
    "Be direct and specific. No fluff. No markdown. Valid JSON only."
)


def track_notes(prompt: str, bpm: float | None, key: str | None,
                duration: float | None) -> dict:
    """Analyze a track and return producer notes as a dict."""
    parts = [f"Prompt: {prompt}"]
    if bpm:   parts.append(f"BPM: {round(bpm)}")
    if key:   parts.append(f"Key: {key}")
    if duration: parts.append(f"Duration: {round(duration)}s")
    user = "\n".join(parts)
    try:
        import json
        raw = _ask(_NOTES_SYS, user, max_tokens=400)
        # strip any accidental markdown fences
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(raw)
    except Exception as e:
        print(f"[groq] track_notes failed: {e}")
        return {
            "vibe": "Could not analyze — check your Groq API key.",
            "strengths": [],
            "suggestions": [],
            "next": "",
        }
