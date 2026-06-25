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


# User-settable keys, persisted in the app's data dir so each customer can add
# their own Groq key(s) — no shared/embedded key. Multiple keys are supported and
# rotated through (so one hitting a rate limit falls back to the next). The env var
# still wins for development.
import json as _json


def _keys_file() -> str:
    try:
        from . import library
    except Exception:
        from music_studio import library
    base = os.path.dirname(getattr(library, "DB_PATH", ""))
    return os.path.join(base or os.path.expanduser("~"), "groq_keys.json")


def get_keys() -> list[str]:
    """All saved user keys (env var key first if present), de-duplicated."""
    keys: list[str] = []
    env = (os.environ.get("GROQ_API_KEY") or "").strip()
    if env:
        keys.append(env)
    try:
        with open(_keys_file(), "r") as f:
            saved = _json.load(f)
            if isinstance(saved, list):
                keys.extend(str(k).strip() for k in saved if str(k).strip())
    except Exception:
        pass
    # de-dupe, preserve order
    seen, out = set(), []
    for k in keys:
        if k and k not in seen:
            seen.add(k); out.append(k)
    return out


def save_keys(keys: list[str]) -> None:
    """Persist the user's key list (env-var key is never written to disk)."""
    path = _keys_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    clean = [str(k).strip() for k in keys if str(k).strip()]
    with open(path, "w") as f:
        _json.dump(clean, f)
    # Owner-only read/write — other user accounts on a shared machine shouldn't
    # be able to read the user's API keys. Best-effort (no-op on Windows).
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def add_key(key: str) -> None:
    key = (key or "").strip()
    if not key:
        return
    saved = _saved_keys_only()
    if key not in saved:
        saved.append(key)
    save_keys(saved)


def remove_key(key: str) -> None:
    save_keys([k for k in _saved_keys_only() if k != (key or "").strip()])


def _saved_keys_only() -> list[str]:
    """Keys from the file only (excludes the env var)."""
    try:
        with open(_keys_file(), "r") as f:
            saved = _json.load(f)
            return [str(k).strip() for k in saved if str(k).strip()] if isinstance(saved, list) else []
    except Exception:
        return []


def validate_key(key: str) -> bool:
    """Real test call so we only ever report a key as working if it actually is."""
    key = (key or "").strip()
    if not key:
        return False
    try:
        with httpx.Client(timeout=15) as c:
            r = c.post(GROQ_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": MODEL, "max_tokens": 1,
                      "messages": [{"role": "user", "content": "hi"}]})
            return r.status_code == 200
    except Exception:
        return False


def _key() -> str | None:
    ks = get_keys()
    return ks[0] if ks else None


def available() -> bool:
    return bool(get_keys())


def _ask(system: str, user: str, max_tokens: int = 220) -> str:
    keys = get_keys()
    if not keys:
        raise RuntimeError("No Groq API key set")
    last_err: Exception | None = None
    # Try each key in turn — if one is rate-limited/invalid, fall back to the next.
    with httpx.Client(timeout=30) as c:
        for key in keys:
            try:
                r = c.post(GROQ_URL,
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": MODEL, "max_tokens": max_tokens, "temperature": 0.7,
                          "messages": [{"role": "system", "content": system},
                                       {"role": "user", "content": user}]})
                if r.status_code in (401, 403, 429):   # bad/exhausted key — try next
                    last_err = RuntimeError(f"key rejected ({r.status_code})")
                    continue
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"].strip()
            except Exception as e:
                last_err = e
                continue
    raise last_err or RuntimeError("All Groq keys failed")


_SOUNDS_LIKE_SYS = (
    "You are a music producer who writes prompts for an instrumental music AI "
    "(MusicGen). The AI does NOT know artist or song names — only sound. "
    "Given an artist, song, or vibe, output ONE single-line prompt describing the "
    "SOUND: genre, approximate BPM, key instruments, production style, era, and mood. "
    "ALWAYS name the DRUM/RHYTHM character specifically (e.g. boom-bap, trap 808s and "
    "hi-hat rolls, four-on-the-floor house kick, breakbeat, half-time, live jazz "
    "brushes, funk groove, reggaeton dembow) — never just say 'drums'. "
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
    "BPM, instruments, a SPECIFIC drum/rhythm style (e.g. boom-bap, trap 808s, "
    "four-on-the-floor, breakbeat, half-time, live kit), mood, production. "
    "Instrumental only. No artist names.")


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


# ── Chat "producer mode": turn a freeform message into a structured action ────
_CHAT_SYS = (
    "You are a music production assistant. The user is editing an AI-generated "
    "instrumental track and types what they want changed. Classify their message "
    "into ONE action and return STRICT JSON (no prose, no markdown). Actions:\n"
    '- {"action":"tweak","tweak":"<short edit phrase>"}  — change the music itself '
    '(more/less of something, mood, energy, instruments). e.g. "make the drums punchier".\n'
    '- {"action":"add_instrument","prompt":"<what to add>"} — add a NEW instrument layer. '
    'e.g. "add a saxophone".\n'
    '- {"action":"preset","preset":"bass-boost|lofi|stream-master"} — apply a named effect preset.\n'
    '- {"action":"pitch","semitones":<int -12..12>} — shift pitch.\n'
    '- {"action":"speed","speed_pct":<int 50..150>} — change tempo/speed.\n'
    '- {"action":"chat","reply":"<one-sentence answer>"} — they asked a question or said '
    "something that isn't an edit; answer briefly.\n"
    "Pick the single best action. Output ONLY the JSON object."
)


def parse_chat(message: str, prompt: str = "", bpm=None, key=None) -> dict:
    """Parse a producer-mode chat message into a structured action dict.
    Falls back to keyword heuristics if Groq is unavailable."""
    import json, re
    msg = (message or "").strip()
    if not msg:
        return {"action": "chat", "reply": "Tell me what to change."}
    if available():
        try:
            ctx = f'Track prompt: "{prompt}". BPM: {bpm}. Key: {key}.\nUser: {msg}'
            raw = _ask(_CHAT_SYS, ctx, max_tokens=160)
            raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            m = re.search(r"\{.*\}", raw, re.S)
            if m:
                d = json.loads(m.group(0))
                if isinstance(d, dict) and d.get("action"):
                    return d
        except Exception as e:
            print(f"[groq] parse_chat failed, using fallback: {e}")
    # ── keyword fallback (no LLM) ───────────────────────────────────────────
    # Tuned so the common producer phrases work well even without a Groq key.
    low = msg.lower().strip()

    # add an instrument / layer  (e.g. "add a piano", "throw in some drums")
    if re.search(r"\b(add|put|throw in|layer|bring in|drop in|include)\b", low):
        thing = re.sub(r".*\b(add|put|throw in|layer|bring in|drop in|include)\b\s*(a |an |some |in )?", "", low)
        thing = thing.strip(" .!") or "drums"
        return {"action": "add_instrument", "prompt": thing[:40]}

    # mastering / loudness
    if any(w in low for w in ("master", "louder", "stream", "loudness", "polish", "clean it up", "professional")):
        return {"action": "preset", "preset": "stream-master"}
    if "bass boost" in low or "more bass" in low or "boost the bass" in low or "heavier bass" in low:
        return {"action": "preset", "preset": "bass-boost"}
    if "lofi" in low or "lo-fi" in low or "lo fi" in low:
        return {"action": "preset", "preset": "lofi"}

    # tempo
    if any(w in low for w in ("slower", "slow it", "slow down", "speed down", "half time", "chill the tempo")):
        return {"action": "speed", "speed_pct": 85}
    if any(w in low for w in ("faster", "speed up", "speed it", "double time", "more bpm", "quicker")):
        return {"action": "speed", "speed_pct": 115}

    # pitch
    if "pitch up" in low or "higher key" in low or "transpose up" in low:
        return {"action": "pitch", "semitones": 2}
    if "pitch down" in low or "lower key" in low or "transpose down" in low or "deeper" in low:
        return {"action": "pitch", "semitones": -2}

    # vibe/character changes → restyle "tweak" (these are the bread-and-butter
    # producer phrases: darker, brighter, more energy, dreamier, warmer, etc.)
    VIBE = ("darker", "brighter", "more energy", "energetic", "hype", "dreamy", "dreamier",
            "warmer", "colder", "harder", "softer", "aggressive", "mellow", "moody",
            "epic", "happy", "sad", "chill", "spacious", "vintage", "modern", "punchier",
            "fuller", "cleaner", "dirtier", "groovier", "ambient", "cinematic", "remix",
            "rework", "redo", "different", "change", "make it", "more ", "less ")
    if any(w in low for w in VIBE):
        return {"action": "tweak", "tweak": msg[:60]}

    # default: treat as a musical tweak (restyle conditioned on the track)
    return {"action": "tweak", "tweak": msg[:60]}
