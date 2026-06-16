# 🎵 AI Music Studio

Generate, process, analyze, and organize royalty-free music from text — fully local & private. Powered by [MusicGen](https://github.com/facebookresearch/audiocraft) (Meta) via Hugging Face Transformers.

A dark, studio-grade UI built with Gradio. Every track is saved locally (WAV + SQLite) with optional Supabase cloud sync.

---

## Features

| | Feature | What it does |
|---|---|---|
| 🎛 | **Studio** | Text → music. Prompt builder, negative prompts, seed control, guidance & temperature |
| 🎚 | **Post-processing** | Normalize, trim silence, seamless loop, fade in/out, pitch shift, speed |
| 📊 | **Auto analysis** | Detects BPM + musical key on every track |
| 🌊 | **Waveform art** | Gradient waveform PNG generated per track |
| 🖼 | **Cover art** | 1000×1000 album cover auto-generated for each track |
| 🎲 | **Variations** | 3 takes of one prompt with different seeds |
| ➕ | **Extend** | Continue any track seamlessly |
| 💿 | **Reference** | Upload a song — borrow its vibe (restyle) or continue it |
| ➕ | **Add Layer** | One-click add drums / bass / keys to a track (smart-matched) |
| 🎚 | **Stems** | Generate drums/bass/melody separately and mix with volumes |
| 🎹 | **Melody** | Hum or upload a melody → restyle into any genre |
| ⚡ | **Batch** | Queue many prompts, generate them all |
| 📚 | **Library** | Search, filter, favorite, rate, tag, play-count — full history |
| 📦 | **Export** | Bundle WAV + MP3 + cover + auto title/description/hashtags (per platform) |
| 🧠 | **Prompt memory** | Learns from your highest-rated tracks and suggests prompts |
| 🎨 | **Dynamic theme** | Accent colors shift to match the genre |
| ⌨️ | **Shortcuts** | ⌘/Ctrl+Enter generate · Space play/pause |

---

## Setup

```bash
# Python 3.12 recommended
python3.12 -m venv music_env
source music_env/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python -m music_studio.app
# opens http://localhost:7860
```

First generation downloads the model (~300MB small / ~1.5GB medium), cached after.

> **Note:** runs CPU-only by default for stability on Apple Silicon (16GB).
> Keep clip duration ≤ 20s; build longer pieces with Extend.

---

## Cloud sync (optional)

Set in a `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Then create the table (`migrations/music_tables.sql`) and a public `music`
storage bucket. Track metadata syncs automatically; audio uploads to storage.
This is what makes the studio deployable to the web later.

---

## Project structure

```
music_studio/
  app.py        # Gradio UI + all handlers
  engine.py     # generation + post-processing + analysis + art
  library.py    # SQLite library + Supabase sync
  extras.py     # distribution export + prompt memory
migrations/
  music_tables.sql
```

## License

Generated audio is royalty-free (MusicGen). Code: MIT.
