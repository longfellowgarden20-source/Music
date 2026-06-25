"""
AI Vocal generation pipeline.

  1. analyze_track()     — deep audio analysis: BPM, key, energy, mood, spectral feel
  2. write_lyrics()      — Groq reads the full analysis and writes ACE-Step formatted lyrics
  3. generate_vocals()   — ACE-Step generates real sung vocals locally on MPS
  4. Audio saved as a stem WAV and added to the library

ACE-Step lyrics format:
  [verse]  [chorus]  [bridge]  [outro]   — section tags
  Lyrics are plain text, one line per phrase.
  ACE-Step handles melody itself — no special tokens needed.
"""
from __future__ import annotations
import os
import tempfile
import numpy as np
import soundfile as sf

from . import library, engine

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "music_output")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

VOICE_STYLES = [
    "warm female pop",
    "deep male RnB",
    "bright female indie",
    "gritty male hip-hop",
    "ethereal female electronic",
]


# ─── 1. Deep track analysis ──────────────────────────────────────────────────

def analyze_track(track_id: int) -> dict:
    """Load a track's audio and extract rich musical features for lyric writing."""
    import librosa

    t = library.get_track(track_id)
    if not t or not t.get("filepath"):
        return {}

    audio, sr = sf.read(t["filepath"], dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    audio_trim, _ = librosa.effects.trim(audio, top_db=30)
    dur = len(audio) / sr

    meta = engine.analyze(np.ascontiguousarray(audio_trim), sr)

    rms = float(librosa.feature.rms(y=audio_trim).mean())
    rms_norm = min(1.0, rms / 0.15)

    centroid = float(librosa.feature.spectral_centroid(y=audio_trim, sr=sr).mean())
    brightness = min(1.0, centroid / 4000.0)

    stft = np.abs(librosa.stft(audio_trim))
    freqs = librosa.fft_frequencies(sr=sr)
    low_mask = freqs < 250
    low_energy = float(stft[low_mask].mean()) / (float(stft.mean()) + 1e-8)
    low_energy = min(1.0, low_energy / 3.0)

    onsets = librosa.onset.onset_detect(y=audio_trim, sr=sr)
    onset_density = len(onsets) / max(dur, 1.0)

    bpm = meta.get("bpm") or 120.0

    if bpm < 75:
        tempo_feel = "very slow and atmospheric"
    elif bpm < 95:
        tempo_feel = "slow and brooding"
    elif bpm < 115:
        tempo_feel = "mid-tempo, steady groove"
    elif bpm < 135:
        tempo_feel = "upbeat and driving"
    else:
        tempo_feel = "fast and energetic"

    if rms_norm > 0.7 and brightness > 0.6:
        mood = "euphoric and intense"
    elif rms_norm > 0.6 and low_energy > 0.5:
        mood = "powerful and bass-heavy"
    elif rms_norm < 0.35 and brightness < 0.4:
        mood = "dark and introspective"
    elif rms_norm < 0.4:
        mood = "melancholic and stripped back"
    elif brightness > 0.65:
        mood = "bright and uplifting"
    elif low_energy > 0.55:
        mood = "warm and bass-forward"
    else:
        mood = "balanced and versatile"

    dominant_band = "bass-heavy" if low_energy > 0.5 else ("bright/trebly" if brightness > 0.6 else "mid-focused")

    return {
        "title": t.get("title", ""),
        "bpm": meta.get("bpm"),
        "key": meta.get("key"),
        "duration": round(dur, 1),
        "energy": round(rms_norm, 2),
        "brightness": round(brightness, 2),
        "low_energy": round(low_energy, 2),
        "onset_density": round(onset_density, 2),
        "tempo_feel": tempo_feel,
        "mood": mood,
        "dominant_band": dominant_band,
        "filepath": t.get("filepath"),
    }


# ─── 2. Lyric writing via Groq ───────────────────────────────────────────────

def write_lyrics(
    prompt: str,
    track_analysis: dict | None = None,
    style: str = "sung",
    bars: int = 8,
) -> tuple[str, str]:
    """Write lyrics + music style prompt for ACE-Step.

    Returns (lyrics_text, acestep_prompt) where:
      - lyrics_text: structured lyrics with [verse]/[chorus] section tags
      - acestep_prompt: genre/mood description for ACE-Step's `prompt` param
    """
    from groq import Groq
    client = Groq(api_key=GROQ_API_KEY)

    a = track_analysis or {}

    brief_parts = []
    if a.get("bpm"):           brief_parts.append(f"BPM: {a['bpm']:.0f}")
    if a.get("key"):           brief_parts.append(f"Key: {a['key']}")
    if a.get("tempo_feel"):    brief_parts.append(f"Tempo feel: {a['tempo_feel']}")
    if a.get("mood"):          brief_parts.append(f"Mood: {a['mood']}")
    if a.get("energy"):        brief_parts.append(f"Energy level: {a['energy']:.0%}")
    if a.get("dominant_band"): brief_parts.append(f"Sound character: {a['dominant_band']}")
    if a.get("title"):         brief_parts.append(f"Track title: {a['title']}")

    musical_brief = "\n".join(f"  • {p}" for p in brief_parts) if brief_parts else "  • No analysis"

    rap_mode = style == "rap"
    section_instruction = (
        "Structure as rap: [verse] for main bars, [hook] for the repeated hook line.\n"
        "Keep bars tight and rhythmic. Match BPM energy."
    ) if rap_mode else (
        "Structure as: [verse] for verses, [chorus] for the hook.\n"
        "Verses: 4-6 lines, conversational. Chorus: 2-4 lines, anthemic and memorable, repeated feeling.\n"
        "Keep lines 5-8 words. Make the chorus instantly singable."
    )

    system = (
        "You are a professional songwriter. Write lyrics for an AI singing model called ACE-Step.\n"
        "Output EXACTLY two things separated by ---:\n"
        "1. The lyrics (with [verse]/[chorus] section tags)\n"
        "2. A one-line music style description for ACE-Step (e.g. 'dark trap, heavy bass, 101 BPM, minor key, emotional')\n\n"
        "Output format:\n"
        "<lyrics here>\n"
        "---\n"
        "<style description here>\n\n"
        "Nothing else. No explanations, no titles."
    )

    user = (
        f"TRACK ANALYSIS:\n{musical_brief}\n\n"
        f"THEME/VIBE: {prompt}\n\n"
        f"STRUCTURE: {section_instruction}\n\n"
        f"Write {bars} bars total across the sections."
    )

    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "system", "content": system},
                  {"role": "user",   "content": user}],
        temperature=0.9,
        max_tokens=600,
    )
    raw = resp.choices[0].message.content.strip()

    # split on ---
    if "---" in raw:
        parts = raw.split("---", 1)
        lyrics_text = parts[0].strip()
        acestep_prompt = parts[1].strip()
    else:
        lyrics_text = raw
        # fallback: derive style from analysis
        mood = a.get("mood", "emotional")
        bpm_str = f"{a['bpm']:.0f} BPM" if a.get("bpm") else ""
        key_str = a.get("key", "")
        band = a.get("dominant_band", "")
        acestep_prompt = ", ".join(filter(None, [mood, band, bpm_str, key_str, "vocals"]))

    return lyrics_text, acestep_prompt


# ─── 3. ACE-Step vocal generation ────────────────────────────────────────────

_acestep_pipeline = None


def _load_acestep():
    global _acestep_pipeline
    if _acestep_pipeline is not None:
        return _acestep_pipeline

    import torch
    from acestep.pipeline_ace_step import ACEStepPipeline

    # ACE-Step is a 3.5B model — on Apple's shared MPS memory it OOMs and HARD-
    # KILLS the engine process (silent, no traceback) on 16GB Macs. ACE-Step's
    # constructor force-upgrades CPU→MPS whenever MPS is available, with no arg to
    # stop it. So to keep it on CPU we temporarily hide MPS from torch during load.
    # Override with STEMAI_ACESTEP_DEVICE=mps on a big-memory machine to allow GPU.
    want = os.environ.get("STEMAI_ACESTEP_DEVICE", "cpu").strip().lower()
    print(f"[vocals] loading ACE-Step on {want}… (this is the heavy one — be patient)")

    _orig_mps_avail = torch.backends.mps.is_available
    try:
        if want != "mps":
            torch.backends.mps.is_available = lambda: False   # force CPU path
        _acestep_pipeline = ACEStepPipeline(
            checkpoint_dir=None,   # auto-download from HuggingFace
            dtype="float32",
            cpu_offload=True,      # keep peak memory down between diffusion steps
        )
    finally:
        torch.backends.mps.is_available = _orig_mps_avail
    print("[vocals] ACE-Step ready")
    return _acestep_pipeline


def generate_vocals(
    lyrics: str,
    acestep_prompt: str,
    duration: float = 30.0,
    ref_audio_path: str | None = None,
    infer_steps: int = 60,
) -> tuple[np.ndarray, int]:
    """Run ACE-Step and return (audio_float32, sample_rate).

    `lyrics`         — structured lyrics with [verse]/[chorus] tags
    `acestep_prompt` — genre/style description (e.g. 'dark trap, heavy bass, 101 BPM')
    `duration`       — output length in seconds (10-120)
    `ref_audio_path` — optional: path to the beat file to guide the style
    """
    pipe = _load_acestep()

    duration = max(10.0, min(120.0, duration))

    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "vocal.wav")

        pipe(
            format="wav",
            audio_duration=duration,
            prompt=acestep_prompt,
            lyrics=lyrics,
            infer_step=infer_steps,
            guidance_scale=15.0,
            scheduler_type="euler",
            cfg_type="apg",
            save_path=out_path,
            # ref audio — guide style/key from the actual beat
            audio2audio_enable=ref_audio_path is not None,
            ref_audio_input=ref_audio_path,
            ref_audio_strength=0.35,
        )

        audio, sr = sf.read(out_path, dtype="float32")

    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    return audio.astype(np.float32), sr


# ─── 4. Full pipeline: prompt → library track ────────────────────────────────

def create_vocal_stem(
    prompt: str,
    track_id: int | None = None,
    style: str = "sung",
    voice: str = "warm female pop",   # passed as style hint in acestep_prompt
    bars: int = 8,
    track_analysis: dict | None = None,
) -> dict:
    """Full pipeline: analyze → write lyrics → ACE-Step generate → save to library."""
    analysis = track_analysis or {}
    if track_id and not analysis:
        analysis = analyze_track(track_id)

    bpm   = analysis.get("bpm")
    key   = analysis.get("key")
    dur   = analysis.get("duration") or 30.0
    title = analysis.get("title") or (library.get_track(track_id) or {}).get("title", "")
    ref_audio = analysis.get("filepath")

    # Lyrics + style description
    lyrics, acestep_prompt = write_lyrics(prompt, track_analysis=analysis, style=style, bars=bars)

    # Inject voice style into the prompt so ACE-Step picks the right vocalist
    if voice and voice not in ("v2/en_speaker_6",):  # skip Bark legacy values
        acestep_prompt = f"{voice}, {acestep_prompt}"

    # Generate — clamp duration: use track length but cap at 60s for speed
    gen_duration = min(60.0, max(20.0, dur))
    audio, sr = generate_vocals(
        lyrics=lyrics,
        acestep_prompt=acestep_prompt,
        duration=gen_duration,
        ref_audio_path=ref_audio,
    )

    # Normalize
    peak = float(np.abs(audio).max())
    if peak > 1e-6:
        audio = audio / peak * 0.88

    os.makedirs(OUT_DIR, exist_ok=True)
    slug = f"vocals_{track_id or 'new'}"
    out_path = os.path.join(OUT_DIR, f"{slug}.wav")
    sf.write(out_path, audio, sr)

    vocal_title = f"{title} — AI vocals" if title else f"AI vocals ({style})"

    if track_id:
        vocal_id = library.add_version(
            track_id, "ai-vocals",
            filepath=out_path,
            prompt=f"AI vocals: {prompt}",
            model="ace-step",
            title=vocal_title,
            collection="Vocals",
            duration=len(audio) / sr,
            bpm=bpm,
            musical_key=key,
        )
    else:
        vocal_id = library.add_track(
            filepath=out_path,
            prompt=f"AI vocals: {prompt}",
            model="ace-step",
            title=vocal_title,
            collection="Vocals",
            duration=len(audio) / sr,
            bpm=bpm,
            musical_key=key,
        )

    return {
        "vocal_id": vocal_id,
        "lyrics": lyrics,
        "acestep_prompt": acestep_prompt,
        "analysis": analysis,
        "duration": len(audio) / sr,
        "track": library.get_track(vocal_id),
    }
