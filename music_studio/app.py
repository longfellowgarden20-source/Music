"""
AI Music Studio — pro UI (Gradio).

Run:  ./music_env/bin/python -m music_studio.app
Opens a dark, studio-style interface at http://localhost:7860

Tabs:
  Studio   — generate, post-process, analyze, save (with all controls)
  Library  — every track ever made: search, filter, favorite, rate, tag, delete
  Batch    — queue many prompts, generate them in sequence
  Settings — model, output info, Supabase sync toggle
"""
from __future__ import annotations
import os
import random
import gradio as gr

# allow running both as module and as a script
try:
    from . import engine, library, extras, effects, groq_helper
except ImportError:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from music_studio import engine, library, extras, effects, groq_helper

# [#10] genre/keyword -> accent palette for dynamic theming
PALETTES = {
    "lofi":      ("#a78bfa", "#f0abfc"),
    "trap":      ("#ef4444", "#f59e0b"),
    "drill":     ("#dc2626", "#7c3aed"),
    "phonk":     ("#b91c1c", "#1f2937"),
    "cinematic": ("#f59e0b", "#fbbf24"),
    "house":     ("#22d3ee", "#06b6d4"),
    "ambient":   ("#34d399", "#5eead4"),
    "synthwave": ("#ec4899", "#8b5cff"),
    "acoustic":  ("#d97706", "#facc15"),
    "jazz":      ("#8b5cff", "#22d3ee"),
    "techno":    ("#64748b", "#22d3ee"),
    "trance":    ("#3b82f6", "#a78bfa"),
    "dubstep":   ("#10b981", "#facc15"),
    "metal":     ("#6b7280", "#ef4444"),
    "rock":      ("#ef4444", "#f59e0b"),
    "funk":      ("#f59e0b", "#ec4899"),
    "reggae":    ("#22c55e", "#facc15"),
    "horror":    ("#7f1d1d", "#1f2937"),
    "fantasy":   ("#8b5cff", "#facc15"),
    "latin":     ("#f97316", "#ef4444"),
    "afrobeat":  ("#f59e0b", "#22c55e"),
    "reggaeton": ("#f97316", "#ec4899"),
    "k-pop":     ("#ec4899", "#22d3ee"),
    "8-bit":     ("#22c55e", "#3b82f6"),
    "chiptune":  ("#22c55e", "#3b82f6"),
    "soul":      ("#a16207", "#f59e0b"),
    "r&b":       ("#a16207", "#f59e0b"),
    "blues":     ("#1e3a8a", "#3b82f6"),
    "country":   ("#d97706", "#facc15"),
}


def palette_for(prompt: str) -> tuple[str, str]:
    p = (prompt or "").lower()
    for key, pal in PALETTES.items():
        if key in p:
            return pal
    return ("#8b5cff", "#22d3ee")  # default

# ── Theme / CSS ─────────────────────────────────────────────────────────────────
CSS = """
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap');

:root, .dark {
  --bg-0:#070710; --bg-1:#0e0e1a; --bg-2:#15151f; --bg-3:#1c1c2b;
  --line:#26263a; --line-2:#33334d;
  --accent:#8b5cff; --accent-2:#22d3ee; --accent-3:#f472b6;
  --text:#edeef5; --muted:#9494b0; --muted-2:#6b6b85;
  --glow:rgba(139,92,255,.35);
}
* { font-family:'Inter',system-ui,sans-serif!important; }
.gradio-container { background:var(--bg-0)!important; max-width:1500px!important;
  margin:0 auto!important; }
body { background:
  radial-gradient(900px 500px at 12% -5%, rgba(139,92,255,.10), transparent 60%),
  radial-gradient(800px 500px at 95% 0%, rgba(34,211,238,.08), transparent 55%),
  var(--bg-0)!important; }

/* ── Hero ─────────────────────────────────────────── */
#hero {
  position:relative; overflow:hidden;
  background:linear-gradient(120deg,#141026 0%,#1a0f33 45%,#0a1c28 100%);
  border:1px solid var(--line-2); border-radius:20px; padding:28px 32px; margin-bottom:14px;
  box-shadow:0 8px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04);
}
#hero::before {
  content:''; position:absolute; inset:0; opacity:.5;
  background:linear-gradient(90deg,transparent,rgba(139,92,255,.18),rgba(34,211,238,.14),transparent);
  background-size:200% 100%; animation:shimmer 6s linear infinite;
}
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
#hero h1 { position:relative; font-family:'Space Grotesk',sans-serif!important;
  font-size:36px; font-weight:700; margin:0; letter-spacing:-1px;
  background:linear-gradient(92deg,#c4b0ff 0%,#a78bfa 35%,#22d3ee 100%);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
#hero p { position:relative; color:#b8b8d0; margin:8px 0 0; font-size:13.5px; font-weight:400; }
.eq { display:inline-flex; gap:3px; align-items:flex-end; height:22px; margin-left:14px;
  vertical-align:middle; }
.eq span { width:3px; background:linear-gradient(180deg,#22d3ee,#8b5cff); border-radius:3px;
  animation:eq 1.1s ease-in-out infinite; }
.eq span:nth-child(1){height:40%;animation-delay:0s}
.eq span:nth-child(2){height:90%;animation-delay:.15s}
.eq span:nth-child(3){height:60%;animation-delay:.3s}
.eq span:nth-child(4){height:100%;animation-delay:.45s}
.eq span:nth-child(5){height:50%;animation-delay:.6s}
@keyframes eq { 0%,100%{transform:scaleY(.4)} 50%{transform:scaleY(1)} }

/* ── Panels / cards ──────────────────────────────── */
.block, .form, .panel, .gr-box, .gr-group {
  background:rgba(20,20,32,.7)!important; backdrop-filter:blur(10px);
  border:1px solid var(--line)!important; border-radius:16px!important; }
.gr-accordion { border-radius:14px!important; border-color:var(--line)!important; }

/* ── Buttons ─────────────────────────────────────── */
button { border-radius:11px!important; transition:all .18s ease!important;
  font-weight:600!important; }
.gr-button-primary, button.primary, button.lg {
  background:linear-gradient(95deg,#8b5cff,#a16bff 50%,#22d3ee)!important;
  background-size:160% 100%!important; border:none!important; color:#fff!important;
  font-weight:700!important; letter-spacing:.3px; box-shadow:0 4px 20px var(--glow)!important; }
.gr-button-primary:hover, button.primary:hover {
  background-position:100% 0!important; transform:translateY(-1px);
  box-shadow:0 6px 28px var(--glow)!important; }
.gr-button-secondary, button.secondary {
  background:var(--bg-3)!important; border:1px solid var(--line-2)!important;
  color:var(--text)!important; }
.gr-button-secondary:hover { border-color:var(--accent)!important;
  color:#fff!important; transform:translateY(-1px); }
button.stop { background:linear-gradient(95deg,#ef4444,#f87171)!important;
  border:none!important; color:#fff!important; }

/* ── Inputs ──────────────────────────────────────── */
label span { color:var(--text)!important; font-weight:600!important; font-size:13px!important; }
input, textarea, select, .gr-input {
  background:var(--bg-2)!important; color:var(--text)!important;
  border:1px solid var(--line)!important; border-radius:10px!important; }
input:focus, textarea:focus { border-color:var(--accent)!important;
  box-shadow:0 0 0 3px rgba(139,92,255,.18)!important; }
input[type=range]{ accent-color:var(--accent)!important; }

/* ── Tabs (Gradio 6: .tab-container row, [role=tab] buttons) ── */
.tab-container, .tab-nav { gap:3px!important; padding:5px!important;
  border-radius:13px!important; background:rgba(20,20,32,.6)!important;
  border:1px solid var(--line)!important; margin-bottom:8px!important;
  flex-wrap:nowrap!important; overflow-x:auto!important; }
[role=tab], .tab-nav button { font-size:13.5px!important; font-weight:600!important;
  color:var(--muted)!important; border:none!important; background:transparent!important;
  padding:8px 14px!important; border-radius:9px!important; white-space:nowrap!important;
  transition:all .15s ease!important; }
[role=tab]:hover { color:var(--text)!important;
  background:rgba(139,92,255,.10)!important; }
[role=tab].selected, [role=tab][aria-selected=true] {
  color:#fff!important; border:none!important;
  background:linear-gradient(95deg,rgba(139,92,255,.40),rgba(34,211,238,.28))!important;
  box-shadow:inset 0 0 0 1px rgba(139,92,255,.45)!important; }
.tab-container::-webkit-scrollbar { height:6px; }
.tabitem { background:transparent!important; padding-top:16px!important; }

/* ── Lock width so content-light tabs don't shrink the layout ── */
.gradio-container { width:100%!important; }
.tabs, .tabitem, .tab-container, [class*="tabitem"] {
  width:100%!important; box-sizing:border-box!important; }
/* every tab panel + its direct columns/rows fill the width */
.tabitem > div, .tabitem .gr-row, .tabitem .gr-column,
.tabitem > .gr-block, .tabitem .form { width:100%!important; }
/* the tab nav row scrolls horizontally instead of wrapping/reflowing */
.tab-nav { flex-wrap:nowrap!important; overflow-x:auto!important;
  width:100%!important; }
.tab-nav::-webkit-scrollbar { height:6px; }

/* ── Stat bar ────────────────────────────────────── */
#statbar { display:flex; gap:12px; margin:4px 0 10px; }
.statcard { flex:1; position:relative; overflow:hidden;
  background:linear-gradient(145deg,rgba(28,28,43,.85),rgba(14,14,26,.85));
  border:1px solid var(--line); border-radius:14px; padding:14px 18px;
  transition:transform .2s ease, border-color .2s ease; }
.statcard:hover { transform:translateY(-2px); border-color:var(--accent); }
.statcard::after { content:''; position:absolute; top:0; left:0; right:0; height:2px;
  background:linear-gradient(90deg,#8b5cff,#22d3ee); opacity:.7; }
.statcard .n { font-family:'Space Grotesk',sans-serif!important; font-size:26px;
  font-weight:700; background:linear-gradient(90deg,#c4b0ff,#22d3ee);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; line-height:1.1; }
.statcard .l { font-size:10.5px; color:var(--muted); text-transform:uppercase;
  letter-spacing:1.5px; margin-top:3px; font-weight:600; }

/* ── Audio player ────────────────────────────────── */
.gr-audio, [data-testid='waveform'] { border-radius:14px!important; }

/* ── Dataframe (Gradio 6 uses .table-wrap / plain th,td) ── */
.table-wrap, .table-container { background:var(--bg-1)!important;
  border:1px solid var(--line)!important; border-radius:12px!important; }
.table-wrap table { font-size:13px!important; background:transparent!important; }
/* header cells */
.table-wrap th, table.header-table th {
  background:var(--bg-3)!important; color:var(--accent-2)!important;
  text-transform:uppercase; font-size:10.5px!important; letter-spacing:1px;
  border-color:var(--line)!important; }
/* data cells — light text on dark */
.table-wrap td {
  background:transparent!important; color:var(--text)!important;
  border-color:var(--line)!important; }
.table-wrap td span, .table-wrap td * { color:var(--text)!important; }
.table-wrap tbody tr:nth-child(even) td { background:rgba(255,255,255,.025)!important; }
.table-wrap tbody tr:hover td { background:rgba(139,92,255,.12)!important; }
/* the cell edit input that shows on click */
.table-wrap input, .table-wrap textarea {
  background:var(--bg-2)!important; color:var(--text)!important; }

/* ── Preset chips row ────────────────────────────── */
.preset-label { color:var(--muted); font-size:11px; text-transform:uppercase;
  letter-spacing:1.5px; font-weight:600; margin:8px 0 2px; }
.panel-title { color:var(--accent-2); font-size:12px; text-transform:uppercase;
  letter-spacing:2px; font-weight:700; margin:2px 0 8px;
  border-bottom:1px solid var(--line); padding-bottom:6px; }

/* ── Scrollbar ───────────────────────────────────── */
::-webkit-scrollbar { width:10px; height:10px; }
::-webkit-scrollbar-track { background:var(--bg-0); }
::-webkit-scrollbar-thumb { background:var(--line-2); border-radius:6px; }
::-webkit-scrollbar-thumb:hover { background:var(--accent); }

/* ════ KILL ALL WHITE — catch every light-default Gradio 6 component ════ */
/* dropdowns (the .wrap.default white boxes) + their option lists */
.wrap, .wrap.default, [class*="wrap"] {
  background:var(--bg-2)!important; color:var(--text)!important; }
ul.options, .options, [class*="dropdown"] ul, li.item {
  background:var(--bg-2)!important; color:var(--text)!important;
  border-color:var(--line)!important; }
ul.options li:hover, li.item:hover, li.item.selected {
  background:rgba(139,92,255,.18)!important; color:#fff!important; }
/* dataframe rows */
.virtual-row, .virtual-table-viewport, .table-wrap, .table-container,
.cell-wrap { background:transparent!important; color:var(--text)!important; }
.virtual-row * { color:var(--text)!important; }
/* radio + checkbox option labels (these go white when selected) */
label.selected, fieldset label, .gr-check-radio label,
[data-testid] label, label[class*="svelte"] {
  background:var(--bg-2)!important; color:var(--text)!important;
  border-color:var(--line)!important; }
label.selected { background:rgba(139,92,255,.25)!important; color:#fff!important;
  border-color:var(--accent)!important; }
/* floating field labels that render on a white chip */
label.float, span.svelte-19djge9, .float {
  background:transparent!important; color:var(--muted)!important; }
/* file upload + image drop zones */
.file-preview, [class*="file"], .upload-container, .image-container,
.empty, .center { background:var(--bg-2)!important; color:var(--text)!important; }
/* any leftover pure-white surface anywhere */
[style*="background: white"], [style*="background:#fff"],
[style*="background-color: white"], [style*="background-color: rgb(255"] {
  background:var(--bg-2)!important; }
/* generic catch: inputs/selects/buttons never light */
select, option { background:var(--bg-2)!important; color:var(--text)!important; }

footer { display:none!important; }
"""

# Production-grade prompt templates, grouped by category. MusicGen responds best
# to: genre + tempo + specific instruments + production descriptors + mood.
GENRE_GROUPS = {
    "Hip-Hop / Trap": {
        "Lofi Hip Hop": "lofi hip hop instrumental, 72 BPM, warm Rhodes electric piano chords, soft dusty boom-bap drums, deep round sub bass, mellow jazzy harmony, vinyl crackle, tape saturation, relaxed late-night mood, professionally mixed",
        "Boom Bap": "classic boom bap hip hop, 90 BPM, hard punchy kick and snare, dusty soul sample chops, deep upright bass, scratches, 90s golden-era vibe, gritty and warm",
        "Trap": "modern trap beat, 140 BPM, booming 808 bass with glide, fast crisp hi-hat rolls, punchy snares, catchy bell melody, atmospheric pads, hard club mix",
        "Dark Trap": "dark trap beat, 140 BPM, distorted aggressive 808, eerie minor-key bells, fast hi-hat triplets, ominous pads, menacing and hard, clean modern mix",
        "Drill": "UK drill beat, 142 BPM, sliding aggressive 808 bass, syncopated skippy hi-hats, hard snares, dark ominous piano melody, gritty street atmosphere",
        "Phonk": "phonk beat, 130 BPM, distorted cowbell melody, heavy memphis 808 bass, aggressive crunchy drums, dark vintage vocal chops, drift-night mood, lo-fi grit",
        "Cloud Rap": "cloud rap beat, 130 BPM, dreamy ethereal synth pads, hazy reverb, soft 808s, atmospheric and spacey, melancholic and floaty",
        "Old School": "old school 80s hip hop, 105 BPM, funky breakbeat drums, electro synth bass, vocoder stabs, turntable scratches, fun and bouncy",
        "Memphis": "memphis rap, 70 BPM, gritty lo-fi 808s, dark cowbell, distorted vocal chops, eerie tape hiss, sinister underground vibe",
        "Plugg": "plugg beat, 140 BPM, dreamy bell synths, bouncy 808s, airy pluggnb chords, smooth and melodic, spacey and light",
        "Rage": "rage beat, 160 BPM, distorted aggressive synth lead, hard-hitting 808s, energetic and chaotic, mosh-pit intensity",
        "Jersey Club": "jersey club, 140 BPM, bouncy triplet kick pattern, bed-squeak samples, chopped vocals, energetic and danceable",
        "West Coast": "west coast g-funk, 95 BPM, high whiny synth lead, funky bass, laid-back drums, sunny california gangsta vibe",
        "Trap Soul": "trap soul, 75 BPM, moody electric piano, smooth 808s, soft trap hats, emotional R&B vocals feel, late-night intimate",
        "Afro-Trap": "afro-trap, 100 BPM, afrobeat percussion, melodic 808s, bright marimba, infectious global groove",
    },
    "Electronic / Dance": {
        "House": "upbeat house track, 124 BPM, punchy four-on-the-floor kick, crisp claps, deep groovy bassline, warm analog synth chords, uplifting piano stabs, energetic club mix",
        "Deep House": "deep house, 122 BPM, smooth rolling sub bass, soft chord stabs, warm pads, shuffled hats, late-night groove, hypnotic and classy",
        "Techno": "driving techno, 130 BPM, relentless pounding kick, dark hypnotic synth stabs, industrial percussion, rumbling bass, warehouse energy, hypnotic",
        "Trance": "uplifting trance, 138 BPM, euphoric supersaw lead, rolling bassline, big emotional breakdown, shimmering arpeggios, festival energy",
        "Dubstep": "heavy dubstep, 140 BPM, massive wobble bass drops, aggressive growls, half-time drums, glitchy effects, hard and intense",
        "Drum and Bass": "drum and bass, 174 BPM, fast breakbeat amen drums, deep rolling reese bass, atmospheric pads, energetic and driving",
        "EDM": "festival EDM, 128 BPM, huge supersaw drop, punchy kick, big build-up, anthemic lead, hands-up energy, massive and bright",
        "Future Bass": "future bass, 150 BPM, lush detuned supersaw chords, pitched vocal chops, punchy drums, emotional and colorful, melodic drop",
        "Synthwave": "retro 80s synthwave, 110 BPM, pulsing analog bass arpeggios, lush gated-reverb drums, bright nostalgic lead synth, neon night-drive mood, vintage chorus",
        "Lo-fi House": "lo-fi house, 120 BPM, dusty filtered chords, bouncy kick, vinyl noise, mellow groovy bassline, warm nostalgic vibe",
        "UK Garage": "UK garage, 130 BPM, shuffled 2-step drums, chopped soulful vocals, deep sub bass, organ stabs, bouncy and groovy",
        "Breakbeat": "breakbeat, 130 BPM, chopped funky break drums, rolling bassline, energetic stabs, old-school rave energy",
        "Hardstyle": "hardstyle, 150 BPM, distorted hard kick, screeching lead, euphoric melody, intense festival rave energy",
        "Psytrance": "psytrance, 145 BPM, rolling triplet bassline, hypnotic acid arpeggios, psychedelic textures, driving and trippy",
        "Downtempo": "downtempo electronica, 95 BPM, lush atmospheric pads, deep mellow bass, soft broken beats, chilled and cinematic",
        "IDM": "intelligent dance music, glitchy intricate drum programming, warm analog synths, complex evolving textures, experimental",
        "Vaporwave": "vaporwave, 70 BPM, slowed nostalgic 80s samples, lush chorus synths, dreamy reverb, retro mall aesthetic, hazy",
        "Gabber": "gabber hardcore, 180 BPM, brutal distorted kicks, aggressive hoover stabs, relentless energy, raw rave intensity",
    },
    "Band / Live": {
        "Rock": "energetic rock, 120 BPM, driving distorted electric guitar riffs, punchy live drums, melodic bass, powerful and anthemic, full band mix",
        "Indie Rock": "indie rock, 118 BPM, jangly clean guitars, steady drums, warm bass, catchy and laid-back, slightly lo-fi, heartfelt",
        "Metal": "heavy metal, 140 BPM, palm-muted distorted guitars, double-kick drums, aggressive riffing, dark and powerful, tight mix",
        "Punk": "fast punk rock, 170 BPM, raw distorted power chords, frantic drums, energetic and rebellious, garage-band rawness",
        "Funk": "funky groove, 105 BPM, slap bass, tight wah guitar, punchy horns, syncopated drums, soulful and danceable",
        "Blues": "slow blues, 70 BPM, expressive electric guitar bends, walking bass, brushed drums, soulful organ, smoky bar mood",
        "Reggae": "classic reggae, 80 BPM, offbeat guitar skank, deep dub bassline, laid-back drums, warm organ, sunny island groove",
        "Country": "modern country, 110 BPM, bright acoustic guitar, pedal steel, steady drums, warm bass, heartfelt and wholesome",
    },
    "Chill / Acoustic": {
        "Acoustic": "intimate acoustic guitar instrumental, gentle fingerpicked steel-string, warm natural tone, soft brushed percussion, subtle upright bass, cozy indie folk, heartfelt",
        "Ambient": "ambient atmospheric music, slow evolving warm synth pads, ethereal textures, gentle reverb, deep sustained drones, calm meditative, spacious, no drums",
        "Chillhop": "chillhop, 85 BPM, jazzy guitar licks, mellow keys, soft boom-bap drums, warm bass, relaxed study vibe, smooth and cozy",
        "Jazz": "smooth late-night jazz, warm walking upright bass, soft brushed drums, expressive tenor saxophone, mellow electric piano, relaxed swing, lounge mood",
        "Bossa Nova": "bossa nova, 110 BPM, soft nylon guitar, gentle shaker, smooth upright bass, mellow and warm, breezy Brazilian groove",
        "Soul / R&B": "smooth R&B soul, 90 BPM, warm electric piano, silky bass, soft trap-soul drums, lush chords, romantic and intimate",
        "Meditation": "calming meditation music, soft drones, gentle singing bowls, airy pads, nature ambience, deeply peaceful and slow",
        "Piano": "solo emotional piano, expressive grand piano, gentle dynamics, reflective melody, intimate and cinematic, close-miked",
        "Trip-Hop": "trip-hop, 85 BPM, dusty downtempo drums, deep moody bass, vinyl crackle, smoky atmosphere, cinematic and dark",
        "Dream Pop": "dream pop, 110 BPM, washy reverb guitars, ethereal pads, soft dreamy melody, hazy and nostalgic, shoegaze textures",
        "Neoclassical": "neoclassical, intimate solo piano with delicate string quartet, emotional and minimal, modern classical, reflective",
        "Study Beats": "study beats, 80 BPM, mellow lo-fi keys, gentle boom-bap drums, soft bass, calm focus mood, unobtrusive and warm",
        "Sleep / Spa": "sleep and spa music, ultra-slow soft pads, gentle piano, water and nature sounds, deeply relaxing, weightless",
        "Post-Rock": "post-rock, 120 BPM, building atmospheric guitars, swelling dynamics, emotional crescendo, cinematic and expansive",
    },
    "Cinematic / Film": {
        "Cinematic Epic": "epic cinematic orchestral score, sweeping legato strings, powerful brass swells, thunderous taiko drums, soaring theme, building to a climax, trailer quality",
        "Cinematic Sad": "emotional cinematic score, delicate solo piano, soft sustained strings, melancholic and tender, slow and moving, film-score quality",
        "Horror": "dark horror score, dissonant strings, eerie drones, sudden stingers, unsettling atmosphere, tense and creepy",
        "Fantasy": "epic fantasy orchestral, heroic French horns, lush strings, choir, adventurous and majestic, grand and uplifting",
        "Orchestral": "classical orchestral piece, full symphony, elegant strings and woodwinds, dynamic and expressive, refined concert-hall sound",
        "Action / Hybrid": "hybrid action trailer score, pounding percussion, aggressive brass, electronic pulses, tense and driving, blockbuster energy",
        "8-Bit Chiptune": "8-bit chiptune, 140 BPM, retro square-wave melodies, arpeggiated bass, NES-style percussion, playful and nostalgic video-game music",
        "Lo-fi Anime": "lo-fi anime, 80 BPM, dreamy japanese-inspired melody, soft koto and piano, mellow boom-bap drums, nostalgic and emotional",
    },
    "World / Global": {
        "Latin": "latin music, 100 BPM, lively brass section, congas and timbales, montuno piano, upbeat and danceable, festive",
        "Afrobeat": "afrobeat, 110 BPM, syncopated percussion, groovy bass, bright guitar, horn stabs, infectious and energetic",
        "Reggaeton": "reggaeton, 95 BPM, dembow rhythm, punchy kick and snare, deep bass, catchy synth melody, club-ready latin groove",
        "K-Pop": "k-pop, 120 BPM, bright punchy synths, energetic drums, catchy hook, polished and colorful, danceable",
        "Amapiano": "amapiano, 112 BPM, deep log-drum bass, airy piano chords, shaker percussion, smooth south-african groove, hypnotic",
        "Dancehall": "dancehall, 100 BPM, bouncy riddim drums, deep bass, catchy island melody, energetic caribbean vibe",
        "Salsa": "salsa, 180 BPM, vibrant horn section, piano montuno, congas and timbales, energetic latin dance groove",
        "Bachata": "bachata, 130 BPM, romantic nylon guitar, bongos and guira, smooth bass, heartfelt dominican groove",
        "Bhangra": "bhangra, 140 BPM, energetic dhol drums, punchy bass, bright punjabi melody, festive and celebratory",
        "Flamenco": "flamenco, 120 BPM, passionate spanish nylon guitar, hand claps, percussive rhythm, fiery and expressive",
        "Samba": "samba, 100 BPM, lively brazilian percussion, surdo and tamborim, bright cavaquinho, carnival energy",
        "Highlife": "highlife, 110 BPM, bright interlocking guitars, horn section, groovy bass, joyful west-african groove",
    },
}

# Flat dict for lookups (build_prompt, presets, palette).
GENRES = {name: prompt for grp in GENRE_GROUPS.values() for name, prompt in grp.items()}

MOODS = ["energetic", "chill", "dark", "happy", "epic", "dreamy", "aggressive",
         "nostalgic", "romantic", "tense", "uplifting", "melancholic"]
INSTRUMENTS = ["piano", "guitar", "808 bass", "strings", "synth pads", "saxophone",
               "drums", "flute", "bells", "vinyl crackle", "choir", "violin"]


# ── Generation handler ────────────────────────────────────────────────────────────
def do_generate(prompt, negative, duration, model_size, guidance, temperature,
                seed_in, do_normalize, fade_in, fade_out, do_loop, do_trim,
                pitch, speed, mp3, auto_analyze, collection,
                master=True, best_n=1, song_name="",
                progress=gr.Progress(track_tqdm=True)):
    def _err(msg):
        # consistent 7-value return so the UI never breaks
        return None, msg, _stats_html(), refresh_library(), None, "", 0

    if not prompt or not prompt.strip():
        return _err("⚠️ Enter a prompt.")

    progress(0.05, desc="Loading model…")
    try:
        seed = int(seed_in) if str(seed_in).strip() not in ("", "-1") else None
    except ValueError:
        seed = None

    take_scores = None
    try:
        n = int(best_n)
        if n > 1:
            progress(0.2, desc=f"Generating {n} takes ({model_size})…")
            sr, audio, used_seed, _sc, take_scores = engine.best_of(
                prompt, n=n, master=False,  # master applied below with the rest
                duration=duration, model_size=model_size,
                guidance=guidance, temperature=temperature)
        else:
            progress(0.2, desc=f"Generating ({model_size})…")
            sr, audio, used_seed = engine.generate(
                prompt=prompt, negative=negative, duration=duration, model_size=model_size,
                guidance=guidance, temperature=temperature, seed=seed)
    except MemoryError as e:
        return _err(f"🛑 {e}")
    except Exception as e:
        return _err(f"⚠️ Generation failed: {e}")

    progress(0.7, desc="Post-processing…")
    if do_trim:
        audio = engine.trim_silence(audio)
    if pitch and pitch != 0:
        audio = engine.pitch_shift(audio, sr, pitch)
    if speed and speed != 1.0:
        sr, audio = engine.change_speed(audio, sr, speed)
    if do_loop:
        audio = engine.make_loop(audio, sr)
    if master:
        progress(0.78, desc="Auto-mastering…")
        audio = engine.auto_master(audio, sr)   # EQ + compression + loudness
    elif do_normalize:
        audio = engine.normalize(audio)
    if fade_in or fade_out:
        audio = engine.fade(audio, sr, fade_in, fade_out)

    analysis = {"bpm": None, "key": None}
    if auto_analyze:
        progress(0.85, desc="Analyzing BPM + key…")
        analysis = engine.analyze(audio, sr)

    progress(0.92, desc="Saving + art…")
    path = engine.save_wav(audio, sr, prompt)
    mp3_path = engine.export_mp3(path) if mp3 else None

    pal = palette_for(prompt)
    base = os.path.splitext(path)[0]
    wf_path = cv_path = None
    try:
        wf_path = engine.waveform_png(audio, sr, base + "_wave.png", pal[0], pal[1])
    except Exception as e:
        print(f"[ui] waveform failed: {e}")
    try:
        cv_path = engine.cover_art(prompt, base + "_cover.png",
                                   bpm=analysis["bpm"], key=analysis["key"], palette=pal)
    except Exception as e:
        print(f"[ui] cover failed: {e}")

    track_id = library.add_track(
        title=(song_name.strip()[:80] if song_name and song_name.strip() else prompt[:60]),
        prompt=prompt, negative=negative, duration=duration,
        model=model_size, guidance=guidance, temperature=temperature, seed=used_seed,
        filepath=path, waveform_path=wf_path or "", cover_path=cv_path or "",
        sample_rate=sr, bpm=analysis["bpm"],
        musical_key=analysis["key"], collection=collection or "All Tracks")

    try:
        library.sync_to_supabase(track_id)
    except Exception:
        pass

    info = (f"✅ **Saved** · #{track_id} · seed `{used_seed}`"
            + (f" · {analysis['bpm']} BPM · key {analysis['key']}" if analysis['bpm'] else "")
            + (" · 🎚 mastered" if master else "")
            + (f" · 🏆 best of {len(take_scores)} (scores {take_scores})" if take_scores else "")
            + (f" · MP3 ✓" if mp3_path else ""))
    theme_html = _theme_accent(pal)
    return ((sr, audio), info, _stats_html(), refresh_library(),
            cv_path, theme_html, track_id)


def _theme_accent(pal):
    """[#10] inject a CSS var override so accents shift to the genre palette."""
    return f"""<style>:root,.dark{{--accent:{pal[0]}!important;
      --accent-2:{pal[1]}!important;--glow:{pal[0]}55!important;}}</style>"""


def _save_simple(audio, sr, prompt, collection, model="small", guidance=3, seed=None,
                 parent_id=None, edit_label="", stems_json=""):
    """Shared save path for variation/extend/stems results (with art).
    If parent_id is given, this is saved as a NEW VERSION of that track's project."""
    audio = engine.normalize(audio)
    an = engine.analyze(audio, sr)
    path = engine.save_wav(audio, sr, prompt)
    pal = palette_for(prompt)
    base = os.path.splitext(path)[0]
    wf = cv = None
    try:
        wf = engine.waveform_png(audio, sr, base + "_wave.png", pal[0], pal[1])
        cv = engine.cover_art(prompt, base + "_cover.png", bpm=an["bpm"],
                              key=an["key"], palette=pal)
    except Exception as e:
        print(f"[ui] art failed: {e}")
    common = dict(title=prompt[:60], prompt=prompt,
        duration=len(audio) / sr, model=model, guidance=guidance, seed=seed,
        filepath=path, waveform_path=wf or "", cover_path=cv or "",
        sample_rate=sr, bpm=an["bpm"], musical_key=an["key"],
        collection=collection or "All Tracks", stems_json=stems_json)
    if parent_id:
        tid = library.add_version(int(parent_id), edit_label, **common)
    else:
        tid = library.add_track(**common)
    try:
        library.sync_to_supabase(tid)
    except Exception:
        pass
    return tid, path, an


# [#3] Variations — N takes of the same prompt
def do_variations(prompt, n, duration, model_size, guidance, collection,
                  song_name="", progress=gr.Progress()):
    if not prompt.strip():
        return None, None, None, "Enter a prompt.", refresh_library(), _stats_html()
    base_name = (song_name.strip() if song_name and song_name.strip()
                 else prompt[:40])
    outs = []
    takes = engine.variations(prompt, n=int(n), duration=duration,
                              model_size=model_size, guidance=guidance)
    first_id = None
    for i, (sr, a, seed) in enumerate(takes):
        progress((i + 1) / len(takes), desc=f"Variation {i+1}/{len(takes)}")
        title = f"{base_name} — take {i+1}"
        if first_id is None:
            # first take starts its own project
            tid, _, _ = _save_simple(a, sr, prompt, collection,
                                     model_size, guidance, seed)
            library.update_track(tid, title=title[:80])
            first_id = tid
        else:
            # rest become VERSIONS of the first -> grouped together
            tid, _, _ = _save_simple(a, sr, prompt, collection,
                                     model_size, guidance, seed,
                                     parent_id=first_id, edit_label=f"take {i+1}")
            library.update_track(tid, title=title[:80])
        outs.append((sr, a))
    outs += [None] * (3 - len(outs))
    return (outs[0], outs[1], outs[2],
            f"✅ {len(takes)} variations of '{base_name}' grouped together.",
            refresh_library(), _stats_html())


# [#2] Extend an existing track
def do_extend(track_id, prompt, add_dur, model_size, guidance, collection,
              progress=gr.Progress()):
    if not track_id:
        return None, "Pick a track ID to extend.", refresh_library(), _stats_html()
    t = library.get_track(int(track_id))
    if not t or not os.path.exists(t["filepath"]):
        return None, "Track not found.", refresh_library(), _stats_html()
    import soundfile as sf
    prior, psr = sf.read(t["filepath"])
    if prior.ndim > 1:
        prior = prior.mean(axis=1)
    progress(0.3, desc="Extending…")
    use_prompt = prompt.strip() or t["prompt"]
    sr, combined, seed = engine.extend(use_prompt, prior.astype("float32"), psr,
                                       add_duration=add_dur, model_size=model_size,
                                       guidance=guidance)
    tid, path, an = _save_simple(combined, sr, use_prompt + " (extended)",
                                 collection, model_size, guidance, seed,
                                 parent_id=int(track_id), edit_label="extended")
    return (sr, combined), f"✅ Extended → v{library.get_track(tid)['version']} of project (#{tid}, {len(combined)/sr:.0f}s)", \
           refresh_library(), _stats_html()


# [#7] Stems mix
def do_stems(p_drums, p_bass, p_melody, v_drums, v_bass, v_melody,
             duration, model_size, guidance, collection, progress=gr.Progress()):
    layers = [
        {"prompt": p_drums, "volume": v_drums, "name": "drums"},
        {"prompt": p_bass, "volume": v_bass, "name": "bass"},
        {"prompt": p_melody, "volume": v_melody, "name": "melody"},
    ]
    progress(0.2, desc="Rendering layers…")
    sr, mix, seeds, stems = engine.stems_mix(layers, duration=duration,
                                             model_size=model_size, guidance=guidance)
    if mix is None:
        return None, "Add at least one layer prompt.", refresh_library(), _stats_html()
    # save each stem WAV so they can be re-mixed later
    import json
    stem_paths = {}
    for st in stems:
        sp = engine.save_wav(st["audio"], sr, f"stem_{st['name']}")
        stem_paths[st["name"]] = {"path": sp, "volume": st["volume"]}
    name = "stem mix: " + ", ".join(
        l["prompt"] for l in layers if l["prompt"].strip())[:50]
    tid, path, an = _save_simple(mix, sr, name, collection, model_size, guidance,
                                 stems_json=json.dumps(stem_paths))
    return (sr, mix), f"✅ Mixed {len(seeds)} layers (stems saved) → #{tid}", \
           refresh_library(), _stats_html()


# [#4] Melody-conditioned (uses extend's audio conditioning under the hood)
def do_melody(melody_file, prompt, duration, model_size, guidance, collection,
              progress=gr.Progress()):
    if not melody_file:
        return None, "Upload or record a melody first.", refresh_library(), _stats_html()
    if not prompt.strip():
        return None, "Describe the style to apply.", refresh_library(), _stats_html()
    import soundfile as sf
    mel, msr = sf.read(melody_file)
    if mel.ndim > 1:
        mel = mel.mean(axis=1)
    progress(0.3, desc="Restyling melody…")
    # condition generation on the uploaded melody
    sr, out, seed = engine.extend(prompt, mel.astype("float32"), msr,
                                  add_duration=duration, model_size=model_size,
                                  guidance=guidance)
    # keep only the newly styled portion after the melody prime
    tid, path, an = _save_simple(out, sr, prompt + " (from melody)",
                                 collection, model_size, guidance, seed)
    return (sr, out), f"✅ Melody restyled → track #{tid}", \
           refresh_library(), _stats_html()


# [NEW] Remix saved stems with new volumes
def load_stems_info(track_id):
    """Show what stems a track has, for the Remix tab."""
    import json
    if not track_id:
        return "Enter a track ID that was made in the Stems tab."
    t = library.get_track(int(track_id))
    if not t or not t.get("stems_json"):
        return "⚠️ That track has no saved stems. Only tracks made in the **Stems** tab have re-mixable layers."
    stems = json.loads(t["stems_json"])
    lines = [f"**Stems in #{track_id}:**"]
    for name, info in stems.items():
        ok = os.path.exists(info["path"])
        lines.append(f"- {name} (vol {info['volume']}) {'✓' if ok else '✗ missing'}")
    return "\n".join(lines)


def do_remix(track_id, v_drums, v_bass, v_melody, collection):
    """Re-mix a stem track's saved layers at new volumes -> new version."""
    import json, numpy as np, soundfile as sf
    if not track_id:
        return None, "Enter a stem track ID.", refresh_library(), _stats_html()
    t = library.get_track(int(track_id))
    if not t or not t.get("stems_json"):
        return None, "That track has no saved stems.", refresh_library(), _stats_html()
    stems = json.loads(t["stems_json"])
    vol_map = {"drums": v_drums, "bass": v_bass, "melody": v_melody}
    loaded, sr = [], None
    for name, info in stems.items():
        if not os.path.exists(info["path"]):
            continue
        a, s = sf.read(info["path"])
        if a.ndim > 1:
            a = a.mean(axis=1)
        sr = s
        loaded.append((a.astype("float32"), float(vol_map.get(name, info["volume"]))))
    if not loaded:
        return None, "Stem files missing.", refresh_library(), _stats_html()
    length = min(len(a) for a, _ in loaded)
    mix = np.zeros(length, dtype="float32")
    for a, vol in loaded:
        mix += a[:length] * vol
    mix = engine.normalize(mix)
    tid, path, an = _save_simple(mix, sr, (t["title"] or "remix") + " (remix)",
                                 collection, parent_id=int(track_id),
                                 edit_label="remix", stems_json=t["stems_json"])
    return (sr, mix), f"✅ Re-mixed → v{library.get_track(tid)['version']} (#{tid})", \
           refresh_library(), _stats_html()


def _load_track_audio_arr(track_id):
    """Load a track's audio as (sr, mono float32) or (None, None)."""
    import soundfile as sf
    t = library.get_track(int(track_id)) if track_id else None
    if not t or not os.path.exists(t["filepath"]):
        return None, None, None
    a, sr = sf.read(t["filepath"])
    if a.ndim > 1:
        a = a.mean(axis=1)
    return sr, a.astype("float32"), t


# [NEW] Effects rack
def do_apply_effect(track_id, effect_name, p1, p2, p3, collection):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, "Pick a valid track ID.", refresh_library(), _stats_html()
    fn, params = effects.EFFECTS[effect_name]
    keys = list(params.keys())
    kw = {}
    for k, val in zip(keys, [p1, p2, p3]):
        kw[k] = val
    out = fn(audio, sr, **kw)
    # stereo widener returns 2D — flatten to mono for storage consistency
    import numpy as np
    if out.ndim > 1:
        out = out.mean(axis=1)
    tid, path, an = _save_simple(out, sr, f"{t['title']} [{effect_name}]",
                                 collection, parent_id=int(track_id),
                                 edit_label=effect_name)
    return (sr, out), f"✅ {effect_name} applied → v{library.get_track(tid)['version']} (#{tid})", \
           refresh_library(), _stats_html()


def update_effect_params(effect_name):
    """Show the right sliders for the chosen effect."""
    fn, params = effects.EFFECTS[effect_name]
    keys = list(params.keys())
    ups = []
    for i in range(3):
        if i < len(keys):
            k = keys[i]
            lo, hi, df = params[k]
            ups.append(gr.update(visible=True, label=k.replace("_", " "),
                                 minimum=lo, maximum=hi, value=df))
        else:
            ups.append(gr.update(visible=False))
    return ups


# [NEW] Arrangement tools
def do_arrange(track_id, op, val_a, val_b, collection):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, "Pick a valid track ID.", refresh_library(), _stats_html()
    label = op
    if op == "Trim":
        out = engine.trim(audio, sr, val_a, val_b)
    elif op == "Reverse":
        out = engine.reverse(audio)
    elif op == "Time-stretch (keep pitch)":
        out = engine.time_stretch(audio, sr, val_a or 1.0)
        label = f"stretch {val_a}x"
    elif op == "Loop to length":
        out = engine.loop_to_length(audio, sr, val_a or 30)
        label = f"loop {val_a}s"
    else:
        return None, "Unknown operation.", refresh_library(), _stats_html()
    tid, path, an = _save_simple(out, sr, f"{t['title']} [{label}]",
                                 collection, parent_id=int(track_id),
                                 edit_label=label)
    return (sr, out), f"✅ {label} → v{library.get_track(tid)['version']} (#{tid})", \
           refresh_library(), _stats_html()


def do_stitch(id_a, id_b, crossfade, collection):
    sr_a, a, ta = _load_track_audio_arr(id_a)
    sr_b, b, tb = _load_track_audio_arr(id_b)
    if a is None or b is None:
        return None, "Pick two valid track IDs.", refresh_library(), _stats_html()
    if sr_a != sr_b:
        import librosa
        b = librosa.resample(b, orig_sr=sr_b, target_sr=sr_a)
    out = engine.stitch([a, b], sr_a, crossfade)
    tid, path, an = _save_simple(out, sr_a, f"{ta['title']} + {tb['title']}", collection)
    return (sr_a, out), f"✅ Stitched → #{tid} ({len(out)/sr_a:.0f}s)", \
           refresh_library(), _stats_html()


# [NEW] Stem separation
def do_split_stems(track_id, collection, progress=gr.Progress()):
    import json
    t = library.get_track(int(track_id)) if track_id else None
    if not t or not os.path.exists(t["filepath"]):
        return "Pick a valid track ID.", refresh_library(), _stats_html()
    progress(0.1, desc="Separating stems (this takes a while on CPU)…")
    try:
        stems = engine.separate_stems(t["filepath"])
    except Exception as e:
        return f"⚠️ Separation failed: {e}", refresh_library(), _stats_html()
    # save each stem as its own library track, linked as versions
    import soundfile as sf
    made = []
    for name, path in stems.items():
        info = sf.info(path)
        tid = library.add_version(int(track_id), f"stem: {name}",
            title=f"{t['title']} — {name}", prompt=f"{name} stem",
            duration=info.frames / info.samplerate, model="demucs", guidance=0,
            seed=0, filepath=path, sample_rate=info.samplerate,
            collection=collection or "Stems")
        made.append(name)
    return (f"✅ Split into {len(made)} stems: {', '.join(made)} "
            f"(saved as versions of #{track_id})"), refresh_library(), _stats_html()


# ════════════════════════════════════════════════════════════════════════════════
# TWEAK WITH A PROMPT — "less drums, more piano, slower" on an existing track
# ════════════════════════════════════════════════════════════════════════════════
def merge_tweak(original_prompt: str, tweak: str) -> str:
    """Fold a natural-language tweak into the original prompt.
    Handles 'less X', 'more X', 'no X', tempo words, and plain additions."""
    base = (original_prompt or "").strip().rstrip(".")
    t = tweak.lower().strip()
    if not t:
        return base
    additions, removals, mods = [], [], []
    # split the tweak into clauses
    import re
    clauses = re.split(r"[,;]| and | but ", t)
    for c in clauses:
        c = c.strip()
        if not c:
            continue
        if c.startswith("more ") or c.startswith("add ") or c.startswith("with "):
            thing = c.split(" ", 1)[1]
            additions.append(f"more {thing}" if c.startswith("more") else thing)
        elif c.startswith("less "):
            removals.append(c.split(" ", 1)[1])
        elif c.startswith("no ") or c.startswith("remove ") or c.startswith("without "):
            removals.append(c.split(" ", 1)[1])
        elif c in ("slower", "faster", "calmer", "harder", "softer", "darker",
                   "brighter", "happier", "sadder", "heavier", "lighter",
                   "more upbeat", "more chill", "more aggressive"):
            mods.append(c)
        else:
            additions.append(c)  # freeform -> just add it
    parts = [base]
    if additions:
        parts.append("with " + ", ".join(additions))
    if mods:
        parts.append(", ".join(mods))
    if removals:
        parts.append("avoid: " + ", ".join(removals))
    return ", ".join(p for p in parts if p)


def do_tweak(track_id, tweak, keep_vibe, model_size, guidance,
             progress=gr.Progress()):
    """Regenerate a track with a natural-language change. Saves as a new version."""
    t = library.get_track(int(track_id)) if track_id else None
    if not t:
        return None, "Load/select a track first.", refresh_library(), _stats_html()
    if not tweak or not tweak.strip():
        return None, "Describe a change, e.g. 'less drums, more piano, slower'.", \
               refresh_library(), _stats_html()
    new_prompt = merge_tweak(t["prompt"], tweak)
    dur = max(4, min(int(t["duration"] or 8), 20))
    progress(0.3, desc=f"Tweaking: {tweak[:40]}…")
    try:
        if keep_vibe and os.path.exists(t["filepath"]):
            import soundfile as sf
            ref, rsr = sf.read(t["filepath"])
            if ref.ndim > 1:
                ref = ref.mean(axis=1)
            sr, out, seed = engine.reference_generate(
                ref.astype("float32"), rsr, prompt=new_prompt, mode="restyle",
                duration=dur, model_size=model_size, guidance=guidance)
        else:
            sr, out, seed = engine.generate(new_prompt, duration=dur,
                model_size=model_size, guidance=guidance)
    except MemoryError as e:
        return None, f"🛑 {e}", refresh_library(), _stats_html()
    tid, path, an = _save_simple(out, sr, new_prompt[:60], "Tweaked",
                                 model_size, guidance, seed,
                                 parent_id=int(track_id), edit_label=f"tweak: {tweak[:25]}")
    return (sr, out), (f"✅ Tweaked → v{library.get_track(tid)['version']} (#{tid})\n\n"
                       f"**New prompt:** {new_prompt}"), refresh_library(), _stats_html()


# ════════════════════════════════════════════════════════════════════════════════
# SONG BUILDER — assemble a full song section-by-section, same persona throughout
# ════════════════════════════════════════════════════════════════════════════════
# Each section role carries a natural energy modifier, like a real song.
SECTION_RECIPES = {
    "Intro": "intro section, stripped back, softer, building up gently, fewer drums",
    "Verse": "verse section, steady groove, moderate energy, room for vocals",
    "Chorus": "chorus section, fuller and bigger, more energy, catchy and lifted, all elements in",
    "Bridge": "bridge section, switch-up, different feel, breakdown, more atmospheric",
    "Drop": "drop section, maximum energy, hard-hitting, full drums and bass",
    "Outro": "outro section, winding down, stripped back, resolving, fading energy",
}

# in-memory plan of the current song being built: list of dicts
_song_sections = []


def _section_table():
    if not _song_sections:
        return [["—", "no sections yet", "—"]]
    return [[i + 1, s["role"], f"{s['dur']}s · {s.get('tweak','')}".strip(" ·")]
            for i, s in enumerate(_song_sections)]


def song_set_base(track_id):
    """Pick the track whose persona every section will follow."""
    t = library.get_track(int(track_id)) if track_id else None
    if not t:
        return "Pick a valid track ID.", _section_table()
    _song_sections.clear()
    return (f"🎵 Base persona: **{t['title'] or t['prompt']}** (#{t['id']}). "
            f"Now add sections below."), _section_table()


def song_add_section(track_id, role, dur, tweak):
    if not track_id:
        return "Set a base track first.", _section_table()
    _song_sections.append({"base_id": int(track_id), "role": role,
                           "dur": int(dur), "tweak": tweak.strip()})
    return f"➕ Added {role} ({dur}s). {len(_song_sections)} sections queued.", _section_table()


def song_clear():
    _song_sections.clear()
    return "Cleared all sections.", _section_table()


def _build_chain(base, sections, model_size, guidance, progress, label):
    """Core song builder: each section CONTINUES from the previous one (so it
    builds off the song and flows), not a fresh take. Returns (sr, full_audio)."""
    import soundfile as sf
    ref, rsr = sf.read(base["filepath"])
    if ref.ndim > 1:
        ref = ref.mean(axis=1)
    ref = ref.astype("float32")

    # the running song — starts as the original track itself
    full = ref
    sr = rsr
    n = len(sections)
    for i, sec in enumerate(sections):
        progress((i + 0.5) / (n + 1), desc=f"Building {sec['role']} ({i+1}/{n})…")
        recipe = SECTION_RECIPES.get(sec["role"], "")
        prompt = merge_tweak(base["prompt"], recipe
                             + (f", {sec['tweak']}" if sec.get("tweak") else ""))
        # CONTINUE from the current end of the song -> real flow, not a new intro
        s, combined, _ = engine.extend(
            prompt, full, sr, add_duration=sec["dur"],
            model_size=model_size, guidance=guidance)
        sr = s
        full = combined          # combined already includes prior audio + new part
    progress(0.95, desc="Mastering the full song…")
    return sr, engine.auto_master(full, sr)


def song_build(model_size, guidance, progress=gr.Progress()):
    """Build the queued sections, chained so the song flows and grows."""
    if not _song_sections:
        return None, "Add sections first.", refresh_library(), _stats_html()
    base = library.get_track(_song_sections[0]["base_id"])
    if not base or not os.path.exists(base["filepath"]):
        return None, "Base track missing.", refresh_library(), _stats_html()
    try:
        sr, full = _build_chain(base, _song_sections, model_size, guidance,
                                progress, "full song")
    except MemoryError as e:
        return None, f"🛑 {e}", refresh_library(), _stats_html()
    roles = "intro → " + " → ".join(s["role"] for s in _song_sections)
    tid, _, _ = _save_simple(full, sr, f"{base['title'] or base['prompt']} (full song)",
                             "Full Songs", model_size, guidance,
                             parent_id=base["id"], edit_label="full song")
    dur = len(full) / sr
    return (sr, full), (f"✅ Full song built → #{tid} · {dur:.0f}s\n\n"
                        f"**Structure:** {roles}"), refresh_library(), _stats_html()


# default arrangement used by one-click auto-finish -> ~60s+ song
AUTO_ARRANGEMENT = [
    ("Verse", 12), ("Chorus", 14), ("Verse", 12),
    ("Bridge", 10), ("Chorus", 14), ("Outro", 10),
]


def auto_finish(track_id, model_size, guidance, progress=gr.Progress()):
    """One click: take a track and build it into a full ~75s song that flows
    from the original (verse/chorus/bridge/outro), keeping the same persona."""
    base = library.get_track(int(track_id)) if track_id else None
    if not base or not os.path.exists(base["filepath"]):
        return None, "Pick a valid track to finish.", refresh_library(), _stats_html()
    sections = [{"base_id": base["id"], "role": r, "dur": d, "tweak": ""}
                for r, d in AUTO_ARRANGEMENT]
    try:
        sr, full = _build_chain(base, sections, model_size, guidance,
                                progress, "auto finish")
    except MemoryError as e:
        return None, f"🛑 {e}", refresh_library(), _stats_html()
    tid, _, _ = _save_simple(full, sr, f"{base['title'] or base['prompt']} (full song)",
                             "Full Songs", model_size, guidance,
                             parent_id=base["id"], edit_label="auto-finished")
    dur = len(full) / sr
    return (sr, full), (f"✅ Auto-finished → #{tid} · {dur:.0f}s, "
                        f"built off your original through verse/chorus/bridge/outro."), \
           refresh_library(), _stats_html()


# ════════════════════════════════════════════════════════════════════════════════
# EDIT STUDIO — a focused dashboard for working on one loaded track
# ════════════════════════════════════════════════════════════════════════════════
def edit_load(track_id):
    """Load a track into the Edit Studio: header, audio, cover, version history."""
    t = library.get_track(int(track_id)) if track_id else None
    if not t:
        return (gr.update(), None, None,
                "⚠️ Track not found.", "")
    audio = t["filepath"] if os.path.exists(t["filepath"]) else None
    cover = t["cover_path"] if t.get("cover_path") and os.path.exists(t["cover_path"]) else None
    header = (f"### 🎵 {t['title'] or t['prompt']}\n"
              f"**#{t['id']}** · {t['model']} · {t['duration']:.0f}s · "
              f"seed `{t['seed']}`"
              + (f" · {t['bpm']:.0f} BPM / {t['musical_key']}" if t['bpm'] else "")
              + f"\n\n*{t['prompt']}*")
    return int(t["id"]), audio, cover, header, _version_history_md(t)


def edit_reload(track_id):
    """Re-load current track after an edit (to refresh player/header/versions)."""
    return edit_load(track_id)


def _edit_apply(track_id, result_tuple):
    """Given a (sr,audio)/status result from an op that made a NEW version,
    switch the Edit Studio to that new version so edits stack."""
    # result_tuple from handlers is ((sr,audio), status, libdata, stats)
    return result_tuple


# Edit Studio operations — each returns: new loaded id, audio, cover, header,
# versions, status, library table, stats
def _edit_result(new_id, status):
    tid, audio, cover, header, vers = edit_load(new_id)
    return tid, audio, cover, header, vers, status, refresh_library(), _stats_html()


def edit_duplicate(track_id):
    if not track_id:
        return _edit_result(track_id, "Load a track first.")
    new_id = library.duplicate_track(int(track_id))
    return _edit_result(new_id, f"✅ Duplicated → now editing copy #{new_id} "
                                f"(original #{int(track_id)} is safe)")


def edit_effect(track_id, effect_name, p1, p2, p3):
    r = do_apply_effect(track_id, effect_name, p1, p2, p3, "Edited")
    # r = (audio, status, lib, stats) ; find the new id from status text
    new_id = _last_id_from_status(r[1]) or track_id
    return _edit_result(new_id, r[1])


def edit_arrange(track_id, op, a, b):
    r = do_arrange(track_id, op, a, b, "Edited")
    new_id = _last_id_from_status(r[1]) or track_id
    return _edit_result(new_id, r[1])


def edit_extend(track_id, prompt, add_dur, model_size, guidance):
    r = do_extend(track_id, prompt, add_dur, model_size, guidance, "Edited")
    new_id = _last_id_from_status(r[1]) or track_id
    return _edit_result(new_id, r[1])


def edit_add_layer(track_id, instrument, blend, vol, model_size, guidance):
    r = do_add_layer(track_id, instrument, blend, vol, model_size, guidance, "Edited")
    new_id = _last_id_from_status(r[1]) or track_id
    return _edit_result(new_id, r[1])


def edit_split(track_id, progress=gr.Progress()):
    msg, libd, st = do_split_stems(track_id, "Stems", progress=progress)
    tid, audio, cover, header, vers = edit_load(track_id)
    return tid, audio, cover, header, vers, msg, libd, st


def edit_tweak(track_id, tweak, keep_vibe, model_size, progress=gr.Progress()):
    r = do_tweak(track_id, tweak, keep_vibe, model_size, 3, progress=progress)
    new_id = _last_id_from_status(r[1]) or track_id
    return _edit_result(new_id, r[1])


def _last_id_from_status(status: str):
    """Pull a '#123' track id out of a status string."""
    import re
    m = re.findall(r"#(\d+)", status or "")
    return int(m[-1]) if m else None


# [#6] Distribution export
def do_export(track_id, platform):
    if not track_id:
        return None, "Pick a track ID."
    res = extras.export_for_distribution(int(track_id), platform=platform, make_zip=True)
    if not res["ok"]:
        return None, f"⚠️ {res.get('error')}"
    files = ", ".join(res["files"])
    return res["zip"], f"✅ Exported **{res['meta']['title']}**\n\nFiles: {files}\n\nZip ready below ⬇"


# [#8] Prompt suggestions
def do_suggest():
    sugg = extras.suggest_prompts(5)
    if not sugg:
        return "Rate or favorite some tracks (★4+) and I'll learn your taste."
    return "**Based on your favorites:**\n\n" + "\n".join(f"- {s}" for s in sugg)


def do_free_memory():
    """Release the loaded model + GC to reclaim RAM, then report free memory."""
    before = engine.free_ram_gb()
    engine.free_memory()
    after = engine.free_ram_gb()
    return (f"🧹 Freed model from memory. RAM: {before:.1f} → {after:.1f} GB free. "
            f"Next generation will reload the model."), _stats_html()


# ── Groq: "sounds like" + "revamp" ──────────────────────────────────────────────
def do_sounds_like(text):
    """Turn an artist/song/vibe into a MusicGen prompt -> fills the prompt box."""
    if not text or not text.strip():
        return gr.update(), "Type an artist, song, or vibe first."
    prompt = groq_helper.sounds_like(text.strip())
    return prompt, f"✨ Translated **{text.strip()}** into a prompt — tweak it or hit Generate."


def do_revamp(track_id, direction, model_size, guidance, progress=gr.Progress()):
    """Reinterpret a track into 'our own melody' (Groq writes a fresh prompt),
    conditioned on the original so it keeps the vibe. Saves as a version."""
    t = library.get_track(int(track_id)) if track_id else None
    if not t or not os.path.exists(t["filepath"]):
        return None, "Pick a valid track to revamp.", refresh_library(), _stats_html()
    progress(0.2, desc="Writing our own take (Groq)…")
    new_prompt = groq_helper.revamp(t["prompt"], direction or "")
    import soundfile as sf
    ref, rsr = sf.read(t["filepath"])
    if ref.ndim > 1:
        ref = ref.mean(axis=1)
    dur = max(8, min(int(t["duration"] or 8), 16))
    progress(0.4, desc="Generating our melody…")
    try:
        sr, out, seed = engine.reference_generate(
            ref.astype("float32"), rsr, prompt=new_prompt, mode="restyle",
            duration=dur, model_size=model_size, guidance=guidance)
    except MemoryError as e:
        return None, f"🛑 {e}", refresh_library(), _stats_html()
    tid, _, _ = _save_simple(out, sr, (t["title"] or "revamp") + " (our melody)",
                             "Revamped", model_size, guidance, seed,
                             parent_id=int(track_id), edit_label="revamp")
    return (sr, out), (f"✅ Revamped → v{library.get_track(tid)['version']} (#{tid})\n\n"
                       f"**Our prompt:** {new_prompt}"), refresh_library(), _stats_html()


# [NEW] Reference a song for inspiration (continue / restyle)
def do_reference(ref_file, prompt, mode, duration, model_size, guidance, collection,
                 progress=gr.Progress()):
    if not ref_file:
        return None, "Upload a reference song first.", refresh_library(), _stats_html()
    import soundfile as sf
    ref, rsr = sf.read(ref_file)
    if ref.ndim > 1:
        ref = ref.mean(axis=1)
    progress(0.3, desc=f"Taking inspiration ({mode})…")
    sr, out, seed = engine.reference_generate(
        ref.astype("float32"), rsr, prompt=prompt, mode=mode, duration=duration,
        model_size=model_size, guidance=guidance)
    name = (prompt.strip() or "reference track") + f" ({mode})"
    tid, path, an = _save_simple(out, sr, name, collection, model_size, guidance, seed)
    return (sr, out), f"✅ {mode.title()} from reference → track #{tid} ({len(out)/sr:.0f}s)", \
           refresh_library(), _stats_html()


# [NEW] Add an instrument layer to an existing track
def do_add_layer(track_id, instrument, blend, volume, model_size, guidance,
                 collection, progress=gr.Progress()):
    if not track_id:
        return None, "Pick a track ID to add to.", refresh_library(), _stats_html()
    if not instrument.strip():
        return None, "Describe the instrument to add.", refresh_library(), _stats_html()
    t = library.get_track(int(track_id))
    if not t or not os.path.exists(t["filepath"]):
        return None, "Track not found.", refresh_library(), _stats_html()
    import soundfile as sf
    base, bsr = sf.read(t["filepath"])
    if base.ndim > 1:
        base = base.mean(axis=1)
    progress(0.3, desc=f"Adding {instrument} ({blend})…")
    sr, mix, seed = engine.add_layer(base.astype("float32"), bsr, instrument,
                                     blend=blend, volume=volume,
                                     model_size=model_size, guidance=guidance)
    name = f"{t['title'] or t['prompt']} + {instrument}"
    tid, path, an = _save_simple(mix, sr, name[:60], collection, model_size, guidance, seed,
                                 parent_id=int(track_id), edit_label=f"+{instrument[:20]}")
    return (sr, mix), f"✅ Added {instrument} → v{library.get_track(tid)['version']} (#{tid})", \
           refresh_library(), _stats_html()


# quick-add buttons on the Studio tab use the last generated track
def quick_add(track_id, instrument, model_size, guidance):
    if not track_id:
        return None, "Generate a track first, then add layers."
    r = do_add_layer(track_id, instrument, "smart", 0.7, model_size, guidance, "Layered")
    return r[0], r[1]


# ── Edit Studio extra tools ────────────────────────────────────────────────────────

def edit_pitch_shift(track_id, semitones):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    import numpy as np
    out = engine.pitch_shift(audio, sr, float(semitones))
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id),
                             edit_label=f"pitch {semitones:+.0f}st")
    return edit_load(tid) + (f"✅ Pitch shifted {semitones:+.0f} semitones → #{tid}",
                              refresh_library(), _stats_html())


def edit_fade(track_id, fade_in_s, fade_out_s):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    out = engine.fade(audio, sr, float(fade_in_s), float(fade_out_s))
    lbl = f"fade in {fade_in_s}s / out {fade_out_s}s"
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label=lbl)
    return edit_load(tid) + (f"✅ {lbl} → #{tid}", refresh_library(), _stats_html())


def edit_normalize(track_id):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    out = engine.normalize(audio)
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label="normalized")
    return edit_load(tid) + (f"✅ Normalized → #{tid}", refresh_library(), _stats_html())


def edit_stereo_widen(track_id, width):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    stereo = effects.stereo_widen(audio, sr, float(width))
    import numpy as np
    mono = stereo.mean(axis=1)
    tid, _, _ = _save_simple(mono, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id),
                             edit_label=f"stereo w={width:.1f}")
    return edit_load(tid) + (f"✅ Stereo widened {width:.1f}x → #{tid}",
                              refresh_library(), _stats_html())


def edit_cut_silence(track_id):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    out = engine.trim_silence(audio)
    saved = len(audio) / sr - len(out) / sr
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label="cut silence")
    return edit_load(tid) + (f"✅ Silence trimmed ({saved:.1f}s removed) → #{tid}",
                              refresh_library(), _stats_html())


def edit_bass_boost(track_id):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    out = effects.eq(audio, sr, low_gain=4.0, mid_gain=0.0, high_gain=0.0)
    out = effects.compressor(out, sr, threshold_db=-20, ratio=3)
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label="bass boost")
    return edit_load(tid) + (f"✅ Bass boost applied → #{tid}", refresh_library(), _stats_html())


def edit_lofi_preset(track_id):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    out = effects.bitcrush(audio, sr, bits=10)
    out = effects.eq(out, sr, low_gain=2.0, mid_gain=-1.0, high_gain=-2.0)
    out = effects.reverb(out, sr, amount=0.2, room=0.3)
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label="lo-fi preset")
    return edit_load(tid) + (f"✅ Lo-fi preset applied → #{tid}", refresh_library(), _stats_html())


def edit_stream_master(track_id):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    out = effects.streaming_master(audio, sr, target_lufs=-14.0)
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label="stream master")
    return edit_load(tid) + (f"✅ Mastered for streaming (-14 LUFS) → #{tid}",
                              refresh_library(), _stats_html())


def edit_speed_change(track_id, speed_pct):
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Load a track first.", None, None
    factor = float(speed_pct) / 100.0
    _, out = engine.change_speed(audio, sr, factor)
    tid, _, _ = _save_simple(out, sr, (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label=f"speed {speed_pct:.0f}%")
    return edit_load(tid) + (f"✅ Speed set to {speed_pct:.0f}% → #{tid}",
                              refresh_library(), _stats_html())


def _parse_time(s: str) -> float:
    """Parse '1:23', '1:23.5', or '45' → seconds."""
    s = (s or "").strip()
    if not s:
        return 0.0
    if ":" in s:
        parts = s.split(":")
        try:
            return int(parts[0]) * 60 + float(parts[1])
        except Exception:
            pass
    try:
        return float(s)
    except Exception:
        return 0.0


def region_preview(track_id, start_str, end_str):
    """Return: (region_audio, waveform_image, info_text)."""
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, "Load a track first."
    start_s = _parse_time(start_str)
    end_s   = _parse_time(end_str)
    total_s = len(audio) / sr
    if end_s <= 0:
        end_s = total_s
    if start_s >= end_s:
        return None, None, f"⚠️ Start must be before end (track is {total_s:.1f}s)"
    region = audio[int(start_s * sr): int(end_s * sr)]
    import tempfile
    import soundfile as sf_mod
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    sf_mod.write(tmp.name, region, sr)
    # waveform with region highlighted
    wf_path = tmp.name.replace(".wav", "_wf.png")
    try:
        engine.region_waveform_png(audio, sr, start_s, end_s, wf_path)
    except Exception as e:
        print(f"[region_preview] waveform failed: {e}")
        wf_path = None
    info = (f"**Region:** {start_str} → {end_str}  "
            f"({end_s - start_s:.1f}s of {total_s:.1f}s total)\n\n"
            f"Describe what you want changed in this region, then hit **Replace Region**.")
    return tmp.name, wf_path, info


def region_replace_handler(track_id, start_str, end_str, prompt,
                           model_size, guidance, xfade,
                           progress=gr.Progress()):
    """Replace a time region with freshly generated music."""
    if not track_id:
        return None, None, None, "", "", "Load a track first.", None, None
    sr, audio, t = _load_track_audio_arr(track_id)
    if audio is None:
        return None, None, None, "", "", "Track file not found.", None, None
    if not prompt or not prompt.strip():
        return None, None, None, "", "", "Describe what you want in this region.", None, None
    start_s = _parse_time(start_str)
    end_s   = _parse_time(end_str)
    total_s = len(audio) / sr
    if end_s <= 0:
        end_s = total_s
    if start_s >= end_s or end_s > total_s + 0.1:
        return (None, None, None, "", "",
                f"⚠️ Invalid range. Track is {total_s:.1f}s.", None, None)
    dur = end_s - start_s
    progress(0.15, desc=f"Generating replacement for {start_s:.1f}s–{end_s:.1f}s…")
    try:
        new_audio, used_seed = engine.region_replace(
            audio, sr, start_s, end_s, prompt.strip(),
            model_size=model_size, guidance=guidance,
            xfade=float(xfade))
    except MemoryError as e:
        return None, None, None, "", "", f"🛑 {e}", None, None
    except Exception as e:
        return None, None, None, "", "", f"⚠️ Region replace failed: {e}", None, None
    lbl = f"region {start_s:.0f}s–{end_s:.0f}s: {prompt[:25]}"
    tid, _, _ = _save_simple(new_audio, sr,
                             (t["title"] or "track"),
                             t.get("collection", "All Tracks"),
                             parent_id=int(track_id), edit_label=lbl)
    return _edit_result(tid,
        f"✅ Region {start_s:.1f}s–{end_s:.1f}s replaced ({dur:.1f}s) → v{library.get_track(tid)['version']} (#{tid})\n\n"
        f"**Region prompt:** {prompt}")


def save_track_notes(track_id, notes_text):
    if track_id:
        library.update_track(int(track_id), notes=notes_text.strip())
    return "✅ Notes saved."


def copy_prompt_to_studio(track_id):
    """Return the track's prompt to fill the Studio prompt box."""
    if not track_id:
        return gr.update(), "Select a track first."
    t = library.get_track(int(track_id))
    if not t:
        return gr.update(), "Track not found."
    return t["prompt"] or "", f"✅ Prompt copied from track #{int(track_id)}"


# ── Library handlers ──────────────────────────────────────────────────────────────
def refresh_library(search="", favs=False, collection="All Tracks", sort="newest",
                    min_dur=0, max_dur=0):
    rows = library.list_tracks(search=search, favorites_only=favs,
                               collection=collection, sort=sort,
                               min_duration=float(min_dur or 0),
                               max_duration=float(max_dur or 0))
    data = []
    for r in rows:
        star = "★" if r["favorite"] else "☆"
        n = r["rating"] or 0
        # color-coded rating: 1-2=grey dot, 3=amber, 4-5=green
        if n >= 4:
            rating = "🟢" * n
        elif n == 3:
            rating = "🟡" * n
        elif n > 0:
            rating = "⚪" * n
        else:
            rating = "—"
        meta = []
        if r["bpm"]:
            meta.append(f"{int(r['bpm'])}bpm")
        if r["musical_key"]:
            meta.append(r["musical_key"])
        data.append([
            r["id"], star, (r["title"] or r["prompt"])[:40],
            r["prompt"] or "",
            r["model"], f"{r['duration']:.0f}s" if r["duration"] else "",
            " ".join(meta), rating, r["created_at"][:16].replace("T", " "),
        ])
    return data


def load_track_audio(track_id):
    t = library.get_track(int(track_id))
    if not t or not os.path.exists(t["filepath"]):
        return None, "Track not found."
    library.update_track(int(track_id), play_count=(t["play_count"] or 0) + 1)
    detail = (f"**{t['title'] or t['prompt']}**\n\n"
              f"Prompt: {t['prompt']}\n\n"
              f"Model: {t['model']} · {t['duration']:.0f}s · guidance {t['guidance']} · "
              f"seed `{t['seed']}`"
              + (f" · {t['bpm']} BPM / {t['musical_key']}" if t['bpm'] else ""))
    return t["filepath"], detail


def _version_history_md(track: dict) -> str:
    """Markdown showing all versions of this track's project + stems if any."""
    import json
    pid = track.get("project_id") or track["id"]
    vers = library.list_versions(pid)
    if len(vers) <= 1 and not track.get("stems_json"):
        lines = ["*This is a single track (no edits yet). Extend it or add layers "
                 "to build versions.*"]
    else:
        lines = [f"**📜 Version history** ({len(vers)} versions):"]
        for v in vers:
            mark = "▶ " if v["id"] == track["id"] else "  "
            label = v["edit_label"] or "original"
            lines.append(f"{mark}**v{v['version']}** · {label} · #{v['id']} "
                         f"· {v['duration']:.0f}s")
    if track.get("stems_json"):
        try:
            stems = json.loads(track["stems_json"])
            lines.append("\n**🎚 Stems available:** " + ", ".join(stems.keys())
                         + " — go to the Remix tab to re-balance them.")
        except Exception:
            pass
    return "\n\n".join(lines)


def on_row_select(search, favs, collection, sort, evt: gr.SelectData):
    """Click a row -> select it; returns
    (track_id, audio, cover, detail, versions, current_title, notes)."""
    rows = library.list_tracks(search=search, favorites_only=favs,
                               collection=collection, sort=sort)
    ridx = evt.index[0] if isinstance(evt.index, (list, tuple)) else evt.index
    if ridx is None or ridx >= len(rows):
        return gr.update(), None, None, "", "", "", ""
    t = rows[ridx]
    library.update_track(t["id"], play_count=(t["play_count"] or 0) + 1)
    detail = (f"### {t['title'] or t['prompt']}\n"
              f"`#{t['id']}` · {t['model']} · {t['duration']:.0f}s"
              + (f" · {int(t['bpm'])} BPM / {t['musical_key']}" if t['bpm'] else "")
              + f"\n\n_{t['prompt']}_")
    path = t["filepath"] if os.path.exists(t["filepath"]) else None
    cover = t["cover_path"] if t.get("cover_path") and os.path.exists(t["cover_path"]) else None
    return (t["id"], path, cover, detail, _version_history_md(t),
            (t["title"] or ""), (t.get("notes") or ""))


def do_recover(search="", favs=False, collection="All Tracks", sort="newest",
               min_dur=0, max_dur=0):
    """Re-import any audio files that lost their library entry."""
    library.recover_orphans()
    return refresh_library(search, favs, collection, sort, min_dur, max_dur), _stats_html()


def toggle_fav(track_id, search="", favs=False, collection="All Tracks", sort="newest"):
    if track_id:
        t = library.get_track(int(track_id))
        if t:
            library.update_track(int(track_id), favorite=0 if t["favorite"] else 1)
    return refresh_library(search, favs, collection, sort)


def heart_track(track_id):
    """Heart a specific track (used by the Studio ♥ button on the last track)."""
    if not track_id:
        return "Generate a track first.", refresh_library(), _stats_html()
    t = library.get_track(int(track_id))
    if not t:
        return "Track not found.", refresh_library(), _stats_html()
    new = 0 if t["favorite"] else 1
    library.update_track(int(track_id), favorite=new)
    msg = "♥ Added to favorites" if new else "♡ Removed from favorites"
    return msg, refresh_library(), _stats_html()


def set_rating(track_id, stars, search="", favs=False, collection="All Tracks", sort="newest"):
    if track_id:
        library.update_track(int(track_id), rating=int(stars))
    return refresh_library(search, favs, collection, sort)


def del_track(track_id, search="", favs=False, collection="All Tracks", sort="newest"):
    if track_id:
        library.delete_track(int(track_id))
    return refresh_library(search, favs, collection, sort), _stats_html()


def add_tag(track_id, tag, search="", favs=False, collection="All Tracks", sort="newest"):
    if track_id and tag and tag.strip():
        t = library.get_track(int(track_id))
        if t:
            tags = set(filter(None, (t["tags"] or "").split(",")))
            tags.add(tag.strip())
            library.update_track(int(track_id), tags=",".join(sorted(tags)))
    return refresh_library(search, favs, collection, sort)


def rename_track(track_id, new_name, search="", favs=False,
                 collection="All Tracks", sort="newest"):
    if track_id and new_name and new_name.strip():
        library.update_track(int(track_id), title=new_name.strip()[:80])
    return refresh_library(search, favs, collection, sort)


# ── Batch ──────────────────────────────────────────────────────────────────────
def batch_generate(prompts_text, duration, model_size, guidance,
                   progress=gr.Progress()):
    prompts = [p.strip() for p in prompts_text.splitlines() if p.strip()]
    if not prompts:
        return "Enter one prompt per line.", refresh_library(), _stats_html()
    done = 0
    for i, p in enumerate(prompts):
        progress((i + 1) / len(prompts), desc=f"[{i+1}/{len(prompts)}] {p[:40]}")
        try:
            sr, audio, seed = engine.generate(
                prompt=p, duration=duration, model_size=model_size, guidance=guidance)
            audio = engine.normalize(audio)
            path = engine.save_wav(audio, sr, p)
            tid = library.add_track(title=p[:60], prompt=p, duration=duration,
                                    model=model_size, guidance=guidance, seed=seed,
                                    filepath=path, sample_rate=sr,
                                    collection="Batch")
            try:
                library.sync_to_supabase(tid)
            except Exception:
                pass
            done += 1
        except Exception as e:
            print(f"[batch] failed '{p}': {e}")
    return f"✅ Generated {done}/{len(prompts)} tracks.", refresh_library(), _stats_html()


# ── Prompt builder ────────────────────────────────────────────────────────────────
_ENERGY_MAP = {
    "Minimal": "minimal arrangement, sparse, stripped back",
    "Medium": "balanced production",
    "Full production": "full rich production, layered, polished",
    "Maximum energy": "maximum energy, massive full production, hard-hitting",
}

def build_prompt(genre, moods, instruments, bpm_text,
                 mood_chips=None, energy="Medium",
                 key_root="", key_scale="", bpm_lock=False, bpm_lock_val=120):
    parts = []
    if genre and genre in GENRES:
        parts.append(GENRES[genre])
    all_moods = list(moods or []) + list(mood_chips or [])
    if all_moods:
        parts.append(", ".join(all_moods))
    if instruments:
        parts.append("featuring " + ", ".join(instruments))
    if energy and energy != "Medium":
        parts.append(_ENERGY_MAP.get(energy, ""))
    if key_root and key_root.strip():
        ks = f"{key_root} {key_scale}".strip() if key_scale else key_root
        parts.append(f"in {ks}")
    if bpm_lock and bpm_lock_val:
        parts.append(f"{int(bpm_lock_val)} BPM")
    elif bpm_text and str(bpm_text).strip():
        parts.append(f"{bpm_text} BPM")
    return ", ".join(p for p in parts if p)


def random_prompt():
    g = random.choice(list(GENRES.keys()))
    m = random.sample(MOODS, k=2)
    ins = random.sample(INSTRUMENTS, k=2)
    return build_prompt(g, m, ins, random.choice(["", "90", "120", "140", "160"]))


def _stats_html():
    s = library.stats()
    mins = s["total_seconds"] / 60
    hrs = mins / 60
    free = engine.free_ram_gb()
    ram_color = "#5eead4" if free > 6 else "#fbbf24" if free > 3 else "#f87171"
    dur_display = f"{hrs:.1f}h" if hrs >= 1 else f"{mins:.0f}m"
    avg_dur = (s["total_seconds"] / s["total"]) if s["total"] else 0
    return f"""
    <div id='statbar'>
      <div class='statcard'><div class='n'>{s['total']}</div><div class='l'>Tracks</div></div>
      <div class='statcard'><div class='n'>{s['favorites']}</div><div class='l'>Favorites</div></div>
      <div class='statcard'><div class='n'>{s['plays']}</div><div class='l'>Plays</div></div>
      <div class='statcard'><div class='n'>{dur_display}</div><div class='l'>Generated</div></div>
      <div class='statcard'><div class='n'>{avg_dur:.0f}s</div><div class='l'>Avg Length</div></div>
      <div class='statcard'><div class='n' style='color:{ram_color};-webkit-text-fill-color:{ram_color}'>{free:.1f}GB</div><div class='l'>Free RAM</div></div>
    </div>"""


LIB_HEADERS = ["ID", "♥", "Title", "Prompt", "Model", "Len", "BPM/Key", "Rating", "Created"]


# ── Build UI ──────────────────────────────────────────────────────────────────────
THEME = gr.themes.Base(primary_hue="purple", neutral_hue="slate").set(
    body_background_fill="#0a0a0f")


# [#9] keyboard shortcuts — Cmd/Ctrl+Enter generates, Space toggles play
SHORTCUTS_JS = """
() => {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const btns = [...document.querySelectorAll('button')];
      const gen = btns.find(b => b.textContent.trim().includes('GENERATE'));
      if (gen) { gen.click(); e.preventDefault(); }
    }
    if (e.code === 'Space' && e.target.tagName !== 'INPUT'
        && e.target.tagName !== 'TEXTAREA') {
      const audio = document.querySelector('audio');
      if (audio) { audio.paused ? audio.play() : audio.pause(); e.preventDefault(); }
    }
  });
}
"""


def build():
    with gr.Blocks(title="AI Music Studio") as app:

        gr.HTML("""
        <div id='hero'>
          <h1>AI MUSIC STUDIO
            <span class='eq'><span></span><span></span><span></span><span></span><span></span></span>
          </h1>
          <p>Generate · process · analyze · organize — fully local &amp; private. Powered by MusicGen.
          &nbsp;·&nbsp; <b>⌘/Ctrl+Enter</b> generate &nbsp; <b>Space</b> play/pause</p>
        </div>""")

        stats = gr.HTML(_stats_html())
        theme_holder = gr.HTML()   # [#10] dynamic accent injection

        # effect param defaults shared by Effects tab + Edit Studio
        _first = list(effects.EFFECTS.values())[0][1]
        _fk = list(_first.keys())

        with gr.Tabs() as main_tabs:
            # ───────────────── STUDIO ─────────────────
            with gr.Tab("🎛  Studio"):
                with gr.Row():
                    with gr.Column(scale=3):
                        song_name = gr.Textbox(label="🎵 Song name (optional)", lines=1,
                            placeholder="leave blank to name it from the prompt")
                        with gr.Row():
                            sounds_like_in = gr.Textbox(show_label=False, scale=3,
                                placeholder="🎤 Sounds like… (artist, song, or vibe — AI writes the prompt)")
                            sounds_like_btn = gr.Button("✨ Translate", scale=1)
                        prompt = gr.Textbox(label="Prompt", lines=3,
                            placeholder="lofi hip hop, warm rhodes, vinyl crackle, rainy mood")
                        negative = gr.Textbox(label="Negative prompt (avoid)", lines=1,
                            placeholder="vocals, distortion")

                        with gr.Accordion("✨ Prompt Builder", open=False):
                            # ── Mood quick-chips ──
                            gr.HTML("<div class='preset-label'>🎭 Quick mood</div>")
                            mood_chips = gr.CheckboxGroup(
                                ["Dark", "Euphoric", "Melancholy", "Aggressive",
                                 "Dreamy", "Tense", "Uplifting", "Nostalgic",
                                 "Chill", "Hypnotic"],
                                label="", show_label=False)
                            # ── Energy ──
                            energy = gr.Radio(
                                ["Minimal", "Medium", "Full production", "Maximum energy"],
                                value="Medium", label="⚡ Energy level")
                            # ── Key picker ──
                            with gr.Row():
                                key_root = gr.Dropdown(
                                    ["", "A", "A#/Bb", "B", "C", "C#/Db", "D", "D#/Eb",
                                     "E", "F", "F#/Gb", "G", "G#/Ab"],
                                    value="", label="🎵 Key root", scale=1)
                                key_scale = gr.Dropdown(
                                    ["", "major", "minor", "dorian", "phrygian",
                                     "lydian", "mixolydian", "locrian"],
                                    value="", label="Scale", scale=1)
                            # ── BPM lock ──
                            with gr.Row():
                                bpm_lock = gr.Checkbox(False, label="🔒 Lock BPM", scale=1)
                                bpm_lock_val = gr.Slider(60, 200, 120, step=1,
                                                         label="BPM", scale=3)
                            # Category first, then the genres within it
                            _cats = list(GENRE_GROUPS.keys())
                            genre_cat = gr.Radio(_cats, value=_cats[0], label="Category")
                            genre = gr.Radio(
                                choices=list(GENRE_GROUPS[_cats[0]].keys()),
                                value=list(GENRE_GROUPS[_cats[0]].keys())[0],
                                label="Genre")
                            bpm_text = gr.Textbox(label="BPM (freetext)", placeholder="120")
                            moods = gr.CheckboxGroup(MOODS, label="Moods")
                            instruments = gr.CheckboxGroup(INSTRUMENTS, label="Instruments")
                            with gr.Row():
                                build_btn = gr.Button("Build prompt →")
                                rand_btn = gr.Button("🎲 Random")

                            # switching category repopulates the genre choices
                            def _on_cat(cat):
                                names = list(GENRE_GROUPS[cat].keys())
                                return gr.update(choices=names, value=names[0])
                            genre_cat.change(_on_cat, genre_cat, genre)

                        with gr.Row():
                            duration = gr.Slider(3, 30, value=15, step=1,
                                label="Duration (s) — longer = more structure")
                            guidance = gr.Slider(1, 10, value=5, step=0.5,
                                label="Guidance — higher follows prompt")
                            temperature = gr.Slider(0.3, 1.5, value=0.95, step=0.05,
                                                    label="Temperature")

                        with gr.Accordion("🎚 Post-processing", open=False):
                            with gr.Row():
                                do_normalize = gr.Checkbox(True, label="Normalize")
                                do_trim = gr.Checkbox(False, label="Trim silence")
                                do_loop = gr.Checkbox(False, label="Seamless loop")
                            with gr.Row():
                                fade_in = gr.Slider(0, 3, 0, step=0.1, label="Fade in (s)")
                                fade_out = gr.Slider(0, 3, 0, step=0.1, label="Fade out (s)")
                            with gr.Row():
                                pitch = gr.Slider(-12, 12, 0, step=1, label="Pitch (semitones)")
                                speed = gr.Slider(0.5, 2.0, 1.0, step=0.05, label="Speed")

                        with gr.Row():
                            master = gr.Checkbox(True,
                                label="🎚 Auto-master (EQ + compression — makes it sound produced)")
                            best_n = gr.Slider(1, 4, value=3, step=1,
                                label="🏆 Best of N (generate N, keep the best)")
                        with gr.Row():
                            model_size = gr.Radio(["small", "medium", "large"], value="small",
                                label="Model — small=fast · medium=good · large=best (slow)")
                            seed_in = gr.Textbox(label="Seed (-1 = random)", value="-1", scale=1)
                        with gr.Row():
                            collection = gr.Textbox(label="Save to collection",
                                                    value="All Tracks", scale=2)
                            mp3 = gr.Checkbox(False, label="Also export MP3")
                            auto_analyze = gr.Checkbox(True, label="Detect BPM/key")

                        with gr.Row():
                            gen_btn = gr.Button("🎵  GENERATE", variant="primary",
                                                size="lg", scale=4)
                            freemem_btn = gr.Button("🧹 Free RAM", size="lg", scale=1)

                    with gr.Column(scale=2):
                        cover_out = gr.Image(label="Cover art", height=240,
                                             show_label=True, interactive=False)
                        audio_out = gr.Audio(label="Output", type="numpy",
                                             interactive=False)
                        info = gr.Markdown("Ready.")
                        last_tid = gr.Number(visible=False, value=0)
                        with gr.Row():
                            heart_btn = gr.Button("♥ Favorite", size="sm", variant="primary")
                            var_btn = gr.Button("🎲 3 Variations", size="sm")
                            ext_btn = gr.Button("➕ Extend +8s", size="sm")
                            exp_btn = gr.Button("📦 Export", size="sm")
                        gr.HTML("<div class='preset-label'>✏️ Tweak this track — describe a change</div>")
                        tweak_box = gr.Textbox(show_label=False,
                            placeholder="less drums, more piano, slower, darker…", lines=1)
                        with gr.Row():
                            tweak_keep = gr.Checkbox(True, label="Keep original vibe", scale=1)
                            tweak_btn = gr.Button("✏️ Apply tweak", size="sm",
                                                  variant="primary", scale=2)
                        gr.HTML("<div class='preset-label'>Add a layer to this track (smart match)</div>")
                        with gr.Row():
                            add_drums = gr.Button("🥁 + Drums", size="sm")
                            add_bass = gr.Button("🎸 + Bass", size="sm")
                            add_keys = gr.Button("🎹 + Keys", size="sm")
                            add_hats = gr.Button("🎵 + Hi-hats", size="sm")
                        gr.HTML("<div class='preset-label'>Popular presets (full list in Prompt Builder)</div>")
                        _popular = ["Lofi Hip Hop", "Trap", "House", "Cinematic Epic",
                                    "Synthwave", "Rock", "Jazz", "Drill", "Ambient",
                                    "Reggaeton", "Future Bass", "Phonk"]
                        for chunk_start in range(0, len(_popular), 4):
                            with gr.Row():
                                for name in _popular[chunk_start:chunk_start + 4]:
                                    gr.Button(name, size="sm").click(
                                        lambda n=name: GENRES[n], outputs=prompt)
                        suggest_btn = gr.Button("🧠 Suggest from my favorites", size="sm")
                        suggest_out = gr.Markdown()

                build_btn.click(build_prompt,
                    [genre, moods, instruments, bpm_text,
                     mood_chips, energy, key_root, key_scale,
                     bpm_lock, bpm_lock_val], prompt)
                rand_btn.click(random_prompt, outputs=prompt)
                suggest_btn.click(do_suggest, outputs=suggest_out)
                # 🎤 Sounds like… -> fills the prompt box
                sounds_like_btn.click(do_sounds_like, sounds_like_in, [prompt, suggest_out])
                sounds_like_in.submit(do_sounds_like, sounds_like_in, [prompt, suggest_out])

            # ───────────────── LIBRARY ─────────────────
            with gr.Tab("📚  Library"):
                # Filter bar
                with gr.Row():
                    search = gr.Textbox(show_label=False, scale=3,
                        placeholder="🔍 Search by name, prompt, or tag…")
                    coll_filter = gr.Dropdown(
                        ["All Tracks", "★ Favorites", "📅 This Week",
                         "⭐ High Rated (4+)", "⏱ Long (60s+)"]
                        + [c for c in library.list_collections()
                           if c not in ("All Tracks",)],
                        value="All Tracks", label="Collection", scale=1)
                    sort = gr.Dropdown(
                        ["newest", "oldest", "rating", "plays", "title",
                         "duration", "bpm"],
                        value="newest", label="Sort", scale=1)
                    favs = gr.Checkbox(False, label="★ Favorites")
                with gr.Row():
                    dur_filter = gr.Dropdown(
                        ["Any length", "Short (<15s)", "Medium (15–45s)",
                         "Long (45–90s)", "Epic (90s+)"],
                        value="Any length", label="⏱ Duration", scale=2)
                    lib_stats_bar = gr.HTML(_stats_html(), scale=3)

                with gr.Row(equal_height=False):
                    # LEFT: the track list
                    with gr.Column(scale=3):
                        gr.HTML("<div class='preset-label'>👆 Click a track to open it on the right</div>")
                        lib = gr.Dataframe(headers=LIB_HEADERS, datatype="str",
                            value=refresh_library(), interactive=False, wrap=True,
                            row_count=(12, "dynamic"),
                            column_widths=["5%", "4%", "20%", "32%", "9%", "7%", "11%", "12%"])
                        with gr.Row():
                            refresh_btn = gr.Button("↻ Refresh", size="sm")
                            recover_btn = gr.Button("🔧 Recover lost", size="sm")

                    # RIGHT: the selected-track panel (clean, grouped)
                    with gr.Column(scale=2):
                        gr.HTML("<div class='panel-title'>NOW SELECTED</div>")
                        sel_cover = gr.Image(show_label=False, height=170,
                                             interactive=False)
                        sel_audio = gr.Audio(show_label=False, type="filepath")
                        sel_detail = gr.Markdown()
                        sel_id = gr.Number(label="Track ID", precision=0)
                        with gr.Row():
                            edit_btn = gr.Button("✏️ Edit", variant="primary", scale=2)
                            play_btn = gr.Button("▶ Play", scale=1)
                            fav_btn = gr.Button("♥", scale=1)
                            del_btn = gr.Button("🗑", variant="stop", scale=1)
                        with gr.Row():
                            rename_in = gr.Textbox(show_label=False, scale=3,
                                placeholder="rename this song…")
                            rename_btn = gr.Button("Rename", scale=1)
                        with gr.Row():
                            rating_in = gr.Slider(0, 5, 0, step=1, label="★ Rating", scale=2)
                            rate_btn = gr.Button("Set", scale=1)
                            tag_in = gr.Textbox(show_label=False, scale=2,
                                                placeholder="add tag")
                            tag_btn = gr.Button("Tag", scale=1)
                        copy_prompt_btn = gr.Button("📋 Copy prompt → Studio", size="sm")
                        with gr.Row():
                            notes_in = gr.Textbox(show_label=False, scale=4,
                                placeholder="✏️ Notes (good for the drop, needs more bass…)",
                                lines=2)
                            notes_save_btn = gr.Button("💾", scale=1)
                        notes_status = gr.Markdown()
                        with gr.Accordion("📜 Version history", open=False):
                            sel_versions = gr.Markdown()

                _DUR_MAP = {
                    "Any length": (0, 0),
                    "Short (<15s)": (0, 15),
                    "Medium (15–45s)": (15, 45),
                    "Long (45–90s)": (45, 90),
                    "Epic (90s+)": (90, 0),
                }
                _SMART_COLL = {"★ Favorites", "📅 This Week", "⭐ High Rated (4+)", "⏱ Long (60s+)"}

                def _resolve_smart(search, favs, coll, sort, dur_label):
                    min_d, max_d = _DUR_MAP.get(dur_label, (0, 0))
                    real_favs = favs
                    real_coll = coll
                    if coll == "★ Favorites":
                        real_favs = True
                        real_coll = "All Tracks"
                    elif coll == "⭐ High Rated (4+)":
                        rows = library.list_tracks(search=search, collection="All Tracks",
                                                    sort=sort, min_duration=min_d, max_duration=max_d)
                        rows = [r for r in rows if (r["rating"] or 0) >= 4]
                        data = []
                        for r in rows:
                            star = "★" if r["favorite"] else "☆"
                            n = r["rating"] or 0
                            rating = ("🟢" * n) if n >= 4 else ("🟡" * n) if n == 3 else ("⚪" * n) if n > 0 else "—"
                            meta = []
                            if r["bpm"]: meta.append(f"{int(r['bpm'])}bpm")
                            if r["musical_key"]: meta.append(r["musical_key"])
                            data.append([r["id"], star, (r["title"] or r["prompt"])[:40],
                                         r["prompt"] or "", r["model"],
                                         f"{r['duration']:.0f}s" if r["duration"] else "",
                                         " ".join(meta), rating,
                                         r["created_at"][:16].replace("T", " ")])
                        return data
                    elif coll == "⏱ Long (60s+)":
                        min_d = max(min_d, 60)
                        real_coll = "All Tracks"
                    elif coll == "📅 This Week":
                        from datetime import datetime, timedelta, timezone
                        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
                        rows = library.list_tracks(search=search, favorites_only=real_favs,
                                                    collection="All Tracks", sort=sort,
                                                    min_duration=min_d, max_duration=max_d)
                        rows = [r for r in rows if r["created_at"] >= week_ago]
                        data = []
                        for r in rows:
                            star = "★" if r["favorite"] else "☆"
                            n = r["rating"] or 0
                            rating = ("🟢" * n) if n >= 4 else ("🟡" * n) if n == 3 else ("⚪" * n) if n > 0 else "—"
                            meta = []
                            if r["bpm"]: meta.append(f"{int(r['bpm'])}bpm")
                            if r["musical_key"]: meta.append(r["musical_key"])
                            data.append([r["id"], star, (r["title"] or r["prompt"])[:40],
                                         r["prompt"] or "", r["model"],
                                         f"{r['duration']:.0f}s" if r["duration"] else "",
                                         " ".join(meta), rating,
                                         r["created_at"][:16].replace("T", " ")])
                        return data
                    return refresh_library(search, real_favs, real_coll, sort, min_d, max_d)

                _filt = [search, favs, coll_filter, sort]
                _filt5 = [search, favs, coll_filter, sort, dur_filter]

                def _refresh(s, f, c, so, d="Any length"):
                    return _resolve_smart(s, f, c, so, d)

                def _refresh5(s, f, c, so, d):
                    return _resolve_smart(s, f, c, so, d)

                def _refresh_all(s, f, c, so, d):
                    cols = (["All Tracks", "★ Favorites", "📅 This Week",
                             "⭐ High Rated (4+)", "⏱ Long (60s+)"]
                            + [x for x in library.list_collections() if x != "All Tracks"])
                    keep = c if c in cols else "All Tracks"
                    return (_resolve_smart(s, f, keep, so, d),
                            gr.update(choices=cols, value=keep),
                            _stats_html())

                refresh_btn.click(_refresh_all, _filt5, [lib, coll_filter, lib_stats_bar])
                recover_btn.click(do_recover, _filt + [gr.State(0), gr.State(0)], [lib, stats])
                search.submit(_refresh5, _filt5, lib)
                search.change(_refresh5, _filt5, lib)
                favs.change(_refresh5, _filt5, lib)
                coll_filter.change(_refresh5, _filt5, lib)
                sort.change(_refresh5, _filt5, lib)
                dur_filter.change(_refresh5, _filt5, lib)

                # click a row -> auto-select + play + cover + history + prefill rename + notes
                lib.select(on_row_select, _filt,
                           [sel_id, sel_audio, sel_cover, sel_detail,
                            sel_versions, rename_in, notes_in])

                # these all respect the active search/filter so the view doesn't jump
                play_btn.click(load_track_audio, sel_id, [sel_audio, sel_detail])
                fav_btn.click(toggle_fav, [sel_id] + _filt, lib)
                del_btn.click(del_track, [sel_id] + _filt, [lib, stats])
                rate_btn.click(set_rating, [sel_id, rating_in] + _filt, lib)
                tag_btn.click(add_tag, [sel_id, tag_in] + _filt, lib)
                rename_btn.click(rename_track, [sel_id, rename_in] + _filt, lib)
                rename_in.submit(rename_track, [sel_id, rename_in] + _filt, lib)
                notes_save_btn.click(save_track_notes, [sel_id, notes_in], notes_status)
                copy_prompt_btn.click(copy_prompt_to_studio, sel_id, [prompt, suggest_out])

            # ───────────────── EDIT STUDIO [NEW] ─────────────────
            with gr.Tab("🎹  Edit Studio", id="edit") as edit_tab:
                gr.HTML("<div class='preset-label'>Your focused workspace — "
                        "load a song from the Library (✏️ Edit) and use every tool here. "
                        "Every edit saves a NEW version, so your original is always safe.</div>")
                e_id = gr.Number(label="Editing track ID", precision=0, value=0)
                with gr.Row():
                    with gr.Column(scale=2):
                        e_cover = gr.Image(label="Cover", height=200, interactive=False)
                        e_audio = gr.Audio(label="Now editing", type="filepath")
                        e_header = gr.Markdown("*Load a track from the Library.*")
                        with gr.Row():
                            e_dupe = gr.Button("🧬 Duplicate (work safely)",
                                               variant="primary")
                            e_reload = gr.Button("↻ Reload")
                        e_versions = gr.Markdown()
                        e_status = gr.Markdown()
                    with gr.Column(scale=3):
                        # ── Region Editor (flagship feature) ──
                        with gr.Accordion("🎯 Region Editor — surgically replace any moment", open=True):
                            gr.HTML("""
                            <div style='background:linear-gradient(90deg,#1a0f33,#0a1c28);
                                border:1px solid #8b5cff55; border-radius:10px; padding:12px 14px;
                                margin-bottom:8px;'>
                              <div style='color:#a78bfa;font-weight:700;font-size:13px;
                                  letter-spacing:.3px;margin-bottom:4px;'>
                                🎯 REGION EDITOR
                              </div>
                              <div style='color:#9494b0;font-size:11px;line-height:1.5;'>
                                Pick any moment in your song, describe what you want changed,
                                and AI regenerates just that section — seamlessly crossfaded back in.
                                Works on 2-minute songs. Every replace saves a new version.
                              </div>
                            </div>""")
                            # Time range inputs
                            with gr.Row():
                                e_reg_start = gr.Textbox(
                                    label="▶ Start", value="0:00",
                                    placeholder="0:45 or 45",
                                    scale=1)
                                e_reg_end = gr.Textbox(
                                    label="⏹ End", value="",
                                    placeholder="1:05 or 65  (blank = end of track)",
                                    scale=1)
                                e_reg_preview_btn = gr.Button("👁 Preview region",
                                                               scale=1, size="sm")
                            # Region waveform — shows the full song with selected region highlighted
                            e_reg_waveform = gr.Image(
                                label="Waveform (yellow = selected region)",
                                show_label=True, height=90, interactive=False)
                            e_reg_audio = gr.Audio(
                                label="Selected region playback", type="filepath",
                                show_label=True)
                            e_reg_info = gr.Markdown()
                            gr.HTML("<div class='preset-label' style='margin-top:8px;'>"
                                    "Describe what you want in this region:</div>")
                            e_reg_prompt = gr.Textbox(
                                show_label=False, lines=2,
                                placeholder="harder drums · add piano break · drop the bass · "
                                            "more atmospheric · silence then big hit · "
                                            "keep same vibe but more tension…")
                            with gr.Row():
                                e_reg_model = gr.Radio(["small", "medium"], value="small",
                                                        label="Model", scale=2)
                                e_reg_guidance = gr.Slider(2, 8, 4, step=0.5,
                                                            label="Guidance", scale=2)
                                e_reg_xfade = gr.Slider(0.05, 0.5, 0.15, step=0.05,
                                                         label="Crossfade (s)", scale=1)
                            e_reg_replace_btn = gr.Button(
                                "🔪 Replace this region", variant="primary", size="lg")
                        # ── Tweak with a prompt ──
                        with gr.Accordion("✏️ Tweak with a prompt", open=False):
                            gr.Markdown("Describe a change in plain words.")
                            e_tweak = gr.Textbox(show_label=False,
                                placeholder="less drums, more piano, slower, darker…")
                            with gr.Row():
                                e_tweak_keep = gr.Checkbox(True, label="Keep original vibe")
                                e_tweak_model = gr.Radio(["small", "medium"],
                                    value="small", label="Model")
                            e_tweak_btn = gr.Button("✏️ Apply tweak", variant="primary")
                        # ── Revamp (Groq writes our own melody) ──
                        with gr.Accordion("🔄 Revamp into our own melody", open=False):
                            gr.Markdown("AI reinterprets this song into a fresh original "
                                        "version — same vibe, new melody. "
                                        + ("🟢 Groq ready" if groq_helper.available()
                                           else "⚪ needs GROQ_API_KEY"))
                            e_revamp_dir = gr.Textbox(show_label=False,
                                placeholder="optional direction: more emotional · darker · uplifting")
                            e_revamp_btn = gr.Button("🔄 Revamp it", variant="primary")
                        # ── One-click presets ──
                        with gr.Accordion("⚡ Quick Presets", open=False):
                            gr.Markdown("One click — applies and saves as a new version.")
                            with gr.Row():
                                e_preset_bass = gr.Button("🔊 Bass Boost", size="sm")
                                e_preset_lofi = gr.Button("📼 Lo-fi", size="sm")
                                e_preset_master = gr.Button("🎚 Stream Master", size="sm")
                                e_normalize_btn = gr.Button("📊 Normalize", size="sm")
                                e_cut_silence_btn = gr.Button("✂️ Cut Silence", size="sm")
                        # ── Pitch & Speed ──
                        with gr.Accordion("🎵 Pitch & Speed", open=False):
                            gr.Markdown("Change pitch without affecting speed, or change speed "
                                        "without affecting pitch.")
                            with gr.Row():
                                e_pitch_slider = gr.Slider(-12, 12, 0, step=1,
                                                            label="Pitch (semitones)")
                                e_pitch_btn = gr.Button("Apply pitch shift")
                            with gr.Row():
                                e_speed_slider = gr.Slider(50, 150, 100, step=1,
                                                            label="Speed %  (100 = original)")
                                e_speed_btn = gr.Button("Apply speed")
                        # ── Fade & Envelope ──
                        with gr.Accordion("🌅 Fade In / Fade Out", open=False):
                            with gr.Row():
                                e_fade_in = gr.Slider(0, 5, 0, step=0.1,
                                                       label="Fade in (s)")
                                e_fade_out = gr.Slider(0, 5, 0, step=0.1,
                                                        label="Fade out (s)")
                            e_fade_btn = gr.Button("Apply fades")
                        # ── Stereo Widen ──
                        with gr.Accordion("↔️ Stereo Widen", open=False):
                            gr.Markdown("Widen the stereo field. 1.0 = mono, 2.0 = wide.")
                            e_width_slider = gr.Slider(0.5, 3.0, 1.5, step=0.1,
                                                        label="Width")
                            e_width_btn = gr.Button("Apply stereo widen")
                        # ── Effects ──
                        with gr.Accordion("🎛 Effects", open=False):
                            with gr.Row():
                                e_fx_name = gr.Dropdown(list(effects.EFFECTS.keys()),
                                    value=list(effects.EFFECTS.keys())[0], label="Effect")
                            with gr.Row():
                                e_fx1 = gr.Slider(_first[_fk[0]][0], _first[_fk[0]][1],
                                    _first[_fk[0]][2], label=_fk[0].replace("_", " "))
                                e_fx2 = gr.Slider(0, 1, 0, label="param 2", visible=len(_fk) > 1)
                                e_fx3 = gr.Slider(0, 1, 0, label="param 3", visible=len(_fk) > 2)
                            e_fx_btn = gr.Button("Apply effect")
                        # ── Arrange ──
                        with gr.Accordion("✂️ Arrange", open=False):
                            e_arr_op = gr.Dropdown(
                                ["Trim", "Reverse", "Time-stretch (keep pitch)", "Loop to length"],
                                value="Trim", label="Operation")
                            with gr.Row():
                                e_arr_a = gr.Slider(0, 60, 0, step=0.5, label="Value A")
                                e_arr_b = gr.Slider(0, 60, 8, step=0.5, label="Value B (trim end)")
                            e_arr_btn = gr.Button("Apply arrange")
                        # ── Extend ──
                        with gr.Accordion("➕ Extend", open=False):
                            e_ext_prompt = gr.Textbox(label="Continue with (optional)",
                                placeholder="keep the same vibe…")
                            with gr.Row():
                                e_ext_dur = gr.Slider(4, 16, 8, step=1, label="Add seconds")
                                e_ext_model = gr.Radio(["small", "medium"], value="small",
                                    label="Model")
                            e_ext_btn = gr.Button("Extend track")
                        # ── Add layer ──
                        with gr.Accordion("🥁 Add Layer", open=False):
                            e_lay_inst = gr.Textbox(label="Instrument",
                                value="punchy drums, crisp hats")
                            with gr.Row():
                                e_lay_blend = gr.Radio(["smart", "simple"], value="smart",
                                    label="Blend")
                                e_lay_vol = gr.Slider(0, 1, 0.7, step=0.05, label="Volume")
                            with gr.Row():
                                e_lay_drums = gr.Button("🥁 Drums")
                                e_lay_bass = gr.Button("🎸 Bass")
                                e_lay_keys = gr.Button("🎹 Keys")
                            e_lay_btn = gr.Button("Add custom layer")
                        # ── Split / Export ──
                        # ── Finish Song (build a full arrangement from this track) ──
                        with gr.Accordion("🎼 Finish Song (build full arrangement)", open=False):
                            gr.Markdown("**One click:** extends THIS track into a full ~75s "
                                        "song — verse → chorus → bridge → chorus → outro — "
                                        "that flows from your original, same vibe throughout.")
                            e_autofinish = gr.Button("🎼 Auto-finish into a full song",
                                                     variant="primary", size="lg")
                            with gr.Accordion("Advanced: build section-by-section", open=False):
                                with gr.Row():
                                    e_sb_role = gr.Dropdown(list(SECTION_RECIPES.keys()),
                                        value="Verse", label="Section")
                                    e_sb_dur = gr.Slider(6, 20, 12, step=1, label="Length (s)")
                                e_sb_tweak = gr.Textbox(label="Extra tweak (optional)",
                                    placeholder="add strings · half-time · brighter")
                                with gr.Row():
                                    e_sb_add = gr.Button("➕ Add section")
                                    e_sb_clear = gr.Button("🗑 Clear")
                                e_sb_table = gr.Dataframe(headers=["#", "Section", "Details"],
                                    value=[["—", "no sections yet", "—"]], interactive=False,
                                    row_count=(3, "dynamic"))
                                e_sb_build = gr.Button("🎼 Build these sections", variant="primary")

                        with gr.Accordion("🔪 Split & 📦 Export", open=False):
                            e_split_btn = gr.Button("🔪 Split into stems")
                            with gr.Row():
                                e_exp_platform = gr.Dropdown(
                                    ["all", "youtube", "beatstars", "tiktok"],
                                    value="all", label="Export platform")
                                e_exp_btn = gr.Button("📦 Build export pack")
                            e_exp_file = gr.File(label="Download (.zip)")

            # ───────────────── SONG BUILDER [NEW] ─────────────────
            with gr.Tab("🎼  Song Builder"):
                gr.Markdown("**Finish a song.** Pick a base track for the persona, then "
                            "add sections (Intro · Verse · Chorus · Bridge · Drop · Outro). "
                            "Each section keeps the same vibe but with its own energy — like a "
                            "real song — then they're stitched into one full track.")
                with gr.Row():
                    sb_base = gr.Number(label="Base track ID (the persona)", precision=0)
                    sb_set = gr.Button("🎵 Set base", variant="primary")
                sb_msg = gr.Markdown()
                with gr.Row():
                    sb_role = gr.Dropdown(list(SECTION_RECIPES.keys()),
                        value="Intro", label="Section")
                    sb_dur = gr.Slider(3, 16, 8, step=1, label="Length (s)")
                    sb_tweak = gr.Textbox(label="Extra tweak (optional)",
                        placeholder="e.g. add strings · half-time · brighter")
                    sb_add = gr.Button("➕ Add section")
                sb_table = gr.Dataframe(headers=["#", "Section", "Details"],
                    value=[["—", "no sections yet", "—"]], interactive=False,
                    row_count=(3, "dynamic"))
                with gr.Row():
                    sb_model = gr.Radio(["small", "medium"], value="small", label="Model")
                    sb_guid = gr.Slider(1, 10, 4, step=0.5, label="Guidance")
                    sb_clear = gr.Button("🗑 Clear sections")
                sb_build = gr.Button("🎼 BUILD FULL SONG", variant="primary", size="lg")
                sb_audio = gr.Audio(label="Finished song", type="numpy")
                sb_status = gr.Markdown()

            # ───────────────── BATCH ─────────────────
            with gr.Tab("⚡  Batch"):
                gr.Markdown("Queue many prompts — one per line — and generate them all.")
                batch_prompts = gr.Textbox(lines=10, label="Prompts (one per line)",
                    placeholder="lofi study beat, piano\ndark trap, 808\ncinematic epic strings")
                with gr.Row():
                    b_duration = gr.Slider(3, 20, 8, step=1, label="Duration each (s)")
                    b_model = gr.Radio(["small", "medium", "large"], value="medium", label="Model")
                    b_guidance = gr.Slider(1, 10, 3, step=0.5, label="Guidance")
                batch_btn = gr.Button("⚡ Generate all", variant="primary", size="lg")
                batch_status = gr.Markdown()

            # ───────────────── STEMS [#7] ─────────────────
            with gr.Tab("🎚  Stems"):
                gr.Markdown("Generate **layers** separately and mix them into one track.")
                with gr.Row():
                    s_drums = gr.Textbox(label="Drums layer", value="punchy drum loop, crisp hats")
                    s_v_drums = gr.Slider(0, 1, 0.8, step=0.05, label="Vol", scale=0)
                with gr.Row():
                    s_bass = gr.Textbox(label="Bass layer", value="deep sub bassline, groovy")
                    s_v_bass = gr.Slider(0, 1, 0.7, step=0.05, label="Vol", scale=0)
                with gr.Row():
                    s_melody = gr.Textbox(label="Melody layer", value="warm piano melody, emotional")
                    s_v_melody = gr.Slider(0, 1, 0.65, step=0.05, label="Vol", scale=0)
                with gr.Row():
                    s_dur = gr.Slider(3, 20, 8, step=1, label="Duration (s)")
                    s_model = gr.Radio(["small", "medium", "large"], value="medium", label="Model")
                    s_guid = gr.Slider(1, 10, 3, step=0.5, label="Guidance")
                    s_coll = gr.Textbox(label="Collection", value="Stems", scale=1)
                stems_btn = gr.Button("🎚 Generate & mix", variant="primary", size="lg")
                stems_audio = gr.Audio(label="Mixed output", type="numpy")
                stems_status = gr.Markdown()

            # ───────────────── MELODY [#4] ─────────────────
            with gr.Tab("🎹  Melody"):
                gr.Markdown("Upload or **record a melody** (hum it!) and restyle it into any genre.")
                mel_in = gr.Audio(label="Your melody", type="filepath", sources=["upload", "microphone"])
                mel_prompt = gr.Textbox(label="Style to apply",
                    placeholder="lofi hip hop, warm rhodes, vinyl crackle")
                with gr.Row():
                    mel_dur = gr.Slider(3, 20, 8, step=1, label="Duration (s)")
                    mel_model = gr.Radio(["small", "medium", "large"], value="medium", label="Model")
                    mel_guid = gr.Slider(1, 10, 3, step=0.5, label="Guidance")
                    mel_coll = gr.Textbox(label="Collection", value="Melody", scale=1)
                mel_btn = gr.Button("🎹 Restyle melody", variant="primary", size="lg")
                mel_audio = gr.Audio(label="Restyled output", type="numpy")
                mel_status = gr.Markdown()

            # ───────────────── REFERENCE [NEW] ─────────────────
            with gr.Tab("💿  Reference"):
                gr.Markdown("Upload a song to **take inspiration** from its beat & vibe. "
                            "_Borrows the feel — doesn't clone the exact track._")
                ref_in = gr.Audio(label="Reference song", type="filepath",
                                  sources=["upload"])
                ref_prompt = gr.Textbox(label="Your twist (optional)",
                    placeholder="make it lofi · slower · darker · add piano")
                with gr.Row():
                    ref_mode = gr.Radio(["restyle", "continue"], value="restyle",
                        label="Mode  (restyle = same vibe + your prompt · continue = extend it)")
                with gr.Row():
                    ref_dur = gr.Slider(3, 20, 8, step=1, label="Duration (s)")
                    ref_model = gr.Radio(["small", "medium", "large"], value="medium", label="Model")
                    ref_guid = gr.Slider(1, 10, 3, step=0.5, label="Guidance")
                    ref_coll = gr.Textbox(label="Collection", value="Inspired", scale=1)
                ref_btn = gr.Button("💿 Generate from reference", variant="primary", size="lg")
                ref_audio = gr.Audio(label="Output", type="numpy")
                ref_status = gr.Markdown()

            # ───────────────── ADD LAYER [NEW] ─────────────────
            with gr.Tab("➕  Add Layer"):
                gr.Markdown("Add **drums, bass, or any instrument** to an existing track.")
                with gr.Row():
                    al_id = gr.Number(label="Track ID", precision=0)
                    al_inst = gr.Textbox(label="Instrument / layer",
                        value="punchy drums, crisp hats", scale=2)
                with gr.Row():
                    al_blend = gr.Radio(["smart", "simple"], value="smart",
                        label="Blend  (smart = match the track · simple = overlay)")
                    al_vol = gr.Slider(0, 1, 0.7, step=0.05, label="Layer volume")
                with gr.Row():
                    al_model = gr.Radio(["small", "medium", "large"], value="medium", label="Model")
                    al_guid = gr.Slider(1, 10, 3, step=0.5, label="Guidance")
                    al_coll = gr.Textbox(label="Collection", value="Layered", scale=1)
                al_btn = gr.Button("➕ Add layer", variant="primary", size="lg")
                al_audio = gr.Audio(label="Output", type="numpy")
                al_status = gr.Markdown()

            # ───────────────── EFFECTS [NEW] ─────────────────
            with gr.Tab("🎛  Effects"):
                gr.Markdown("Apply **studio effects** to any track — EQ, reverb, delay, "
                            "compression, mastering and more. Saves as a new version.")
                with gr.Row():
                    fx_id = gr.Number(label="Track ID", precision=0)
                    fx_name = gr.Dropdown(list(effects.EFFECTS.keys()),
                        value=list(effects.EFFECTS.keys())[0], label="Effect")
                with gr.Row():
                    fx_p1 = gr.Slider(_first[_fk[0]][0], _first[_fk[0]][1],
                        _first[_fk[0]][2], label=_fk[0].replace("_", " "),
                        visible=len(_fk) > 0)
                    fx_p2 = gr.Slider(0, 1, 0, label="param 2", visible=len(_fk) > 1)
                    fx_p3 = gr.Slider(0, 1, 0, label="param 3", visible=len(_fk) > 2)
                fx_coll = gr.Textbox(label="Collection", value="Effects")
                fx_btn = gr.Button("🎛 Apply effect", variant="primary", size="lg")
                fx_audio = gr.Audio(label="Output", type="numpy")
                fx_status = gr.Markdown()

            # ───────────────── ARRANGE [NEW] ─────────────────
            with gr.Tab("✂️  Arrange"):
                gr.Markdown("**Edit & arrange** — trim, reverse, time-stretch, loop to "
                            "length, or stitch two tracks into a longer song.")
                with gr.Row():
                    arr_id = gr.Number(label="Track ID", precision=0)
                    arr_op = gr.Dropdown(
                        ["Trim", "Reverse", "Time-stretch (keep pitch)", "Loop to length"],
                        value="Trim", label="Operation")
                with gr.Row():
                    arr_a = gr.Slider(0, 60, 0, step=0.5,
                        label="Value A (trim start / stretch rate / loop secs)")
                    arr_b = gr.Slider(0, 60, 8, step=0.5, label="Value B (trim end)")
                arr_coll = gr.Textbox(label="Collection", value="Arranged")
                arr_btn = gr.Button("✂️ Apply", variant="primary", size="lg")
                arr_audio = gr.Audio(label="Output", type="numpy")
                arr_status = gr.Markdown()
                gr.Markdown("**Stitch two tracks** into one (crossfaded):")
                with gr.Row():
                    st_a = gr.Number(label="First track ID", precision=0)
                    st_b = gr.Number(label="Second track ID", precision=0)
                    st_xf = gr.Slider(0, 3, 0.5, step=0.1, label="Crossfade (s)")
                st_btn = gr.Button("🔗 Stitch", size="lg")
                st_audio = gr.Audio(label="Stitched output", type="numpy")
                st_status = gr.Markdown()

            # ───────────────── SPLIT STEMS [NEW] ─────────────────
            with gr.Tab("🔪  Split Stems"):
                gr.Markdown("**Separate any track** into drums / bass / vocals / other "
                            "(powered by Demucs). Each stem saves as a version you can "
                            "remix, replace, or build on.\n\n"
                            "⚠️ Slow on CPU — give it a few minutes per track.")
                with gr.Row():
                    sp_id = gr.Number(label="Track ID to split", precision=0)
                    sp_coll = gr.Textbox(label="Collection", value="Stems", scale=1)
                sp_btn = gr.Button("🔪 Split into stems", variant="primary", size="lg")
                sp_status = gr.Markdown()

            # ───────────────── REMIX [NEW] ─────────────────
            with gr.Tab("🎚  Remix"):
                gr.Markdown("Re-balance the **stems** of a track made in the Stems tab. "
                            "Adjust each layer's volume and save a new version.")
                with gr.Row():
                    rmx_id = gr.Number(label="Stem track ID", precision=0)
                    rmx_load = gr.Button("Load stems")
                rmx_info = gr.Markdown()
                with gr.Row():
                    rmx_drums = gr.Slider(0, 1.5, 0.8, step=0.05, label="🥁 Drums vol")
                    rmx_bass = gr.Slider(0, 1.5, 0.7, step=0.05, label="🎸 Bass vol")
                    rmx_melody = gr.Slider(0, 1.5, 0.65, step=0.05, label="🎹 Melody vol")
                rmx_coll = gr.Textbox(label="Collection", value="Remixes")
                rmx_btn = gr.Button("🎚 Re-mix stems", variant="primary", size="lg")
                rmx_audio = gr.Audio(label="Re-mixed output", type="numpy")
                rmx_status = gr.Markdown()

            # ───────────────── EXPORT [#6] ─────────────────
            with gr.Tab("📦  Export"):
                gr.Markdown("Bundle a track into an **upload-ready pack** — "
                            "WAV + MP3 + cover art + auto title/description/hashtags.")
                with gr.Row():
                    exp_id = gr.Number(label="Track ID", precision=0)
                    exp_platform = gr.Dropdown(["all", "youtube", "beatstars", "tiktok"],
                        value="all", label="Platform")
                exp_go = gr.Button("📦 Build export pack", variant="primary", size="lg")
                exp_status = gr.Markdown()
                exp_file = gr.File(label="Download pack (.zip)")

            # ───────────────── SETTINGS ─────────────────
            with gr.Tab("⚙  Settings"):
                gr.Markdown(f"""
### Output
All tracks save to **`{os.path.abspath(engine.OUT_DIR)}`**
Metadata lives in **`{library.DB_PATH}`** (SQLite).

### Models
- **small** — 300M, fast, low memory — recommended on 16GB
- **medium** — 1.5B, better quality, heavier (slower on CPU)

### Cloud sync
If `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, each track's
metadata syncs to a `music_tracks` table and audio uploads to a `music` storage
bucket. This is what powers the future Vercel deployment.

### Performance
Generation is **CPU-only** for stability on Apple Silicon 16GB. Keep duration
≤ 20s. Longer pieces: generate sections and stitch in the Library.
""")
                gr.Markdown("**Supabase status:** " +
                    ("🟢 configured" if os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
                     else "⚪ not configured (local only)"))

        # ── Wiring (after all components exist) ──
        gen_btn.click(
            do_generate,
            [prompt, negative, duration, model_size, guidance, temperature, seed_in,
             do_normalize, fade_in, fade_out, do_loop, do_trim, pitch, speed, mp3,
             auto_analyze, collection, master, best_n, song_name],
            [audio_out, info, stats, lib, cover_out, theme_holder, last_tid])

        # ♥ Favorite the just-generated track from the Studio
        heart_btn.click(heart_track, last_tid, [info, lib, stats])
        freemem_btn.click(do_free_memory, outputs=[info, stats])

        # ✏️ Tweak the just-generated track from the Studio
        tweak_btn.click(do_tweak,
            [last_tid, tweak_box, tweak_keep, model_size, guidance],
            [audio_out, info, lib, stats])

        batch_btn.click(batch_generate,
            [batch_prompts, b_duration, b_model, b_guidance],
            [batch_status, lib, stats])

        # [#3] Variations — generate 3 (grouped as one project), show first
        def _variations_single(p, d, m, g, c, nm):
            a1, a2, a3, msg, libd, st = do_variations(p, 3, d, m, g, c, nm)
            return a1, msg, libd, st
        var_btn.click(_variations_single,
            [prompt, duration, model_size, guidance, collection, song_name],
            [audio_out, info, lib, stats])

        # [#2] Extend last/selected track
        ext_btn.click(do_extend,
            [last_tid, prompt, gr.State(8), model_size, guidance, collection],
            [audio_out, info, lib, stats])

        # [#7] Stems
        stems_btn.click(do_stems,
            [s_drums, s_bass, s_melody, s_v_drums, s_v_bass, s_v_melody,
             s_dur, s_model, s_guid, s_coll],
            [stems_audio, stems_status, lib, stats])

        # [#4] Melody restyle
        mel_btn.click(do_melody,
            [mel_in, mel_prompt, mel_dur, mel_model, mel_guid, mel_coll],
            [mel_audio, mel_status, lib, stats])

        # [#6] Export tab
        exp_go.click(do_export, [exp_id, exp_platform], [exp_file, exp_status])
        exp_btn.click(do_export, [last_tid, gr.State("all")], [exp_file, exp_status])

        # [NEW] Reference inspiration
        ref_btn.click(do_reference,
            [ref_in, ref_prompt, ref_mode, ref_dur, ref_model, ref_guid, ref_coll],
            [ref_audio, ref_status, lib, stats])

        # [NEW] Add layer tab
        al_btn.click(do_add_layer,
            [al_id, al_inst, al_blend, al_vol, al_model, al_guid, al_coll],
            [al_audio, al_status, lib, stats])

        # [NEW] Studio quick-add layer buttons (use last generated track)
        add_drums.click(lambda tid, m, g: quick_add(tid, "punchy drums, crisp hi-hats", m, g),
            [last_tid, model_size, guidance], [audio_out, info])
        add_bass.click(lambda tid, m, g: quick_add(tid, "deep sub bassline", m, g),
            [last_tid, model_size, guidance], [audio_out, info])
        add_keys.click(lambda tid, m, g: quick_add(tid, "warm piano keys, melodic", m, g),
            [last_tid, model_size, guidance], [audio_out, info])
        add_hats.click(lambda tid, m, g: quick_add(tid, "crisp hi-hats, percussion", m, g),
            [last_tid, model_size, guidance], [audio_out, info])

        # [NEW] Remix tab
        rmx_load.click(load_stems_info, rmx_id, rmx_info)
        rmx_btn.click(do_remix,
            [rmx_id, rmx_drums, rmx_bass, rmx_melody, rmx_coll],
            [rmx_audio, rmx_status, lib, stats])

        # [NEW] Effects tab
        fx_name.change(update_effect_params, fx_name, [fx_p1, fx_p2, fx_p3])
        fx_btn.click(do_apply_effect,
            [fx_id, fx_name, fx_p1, fx_p2, fx_p3, fx_coll],
            [fx_audio, fx_status, lib, stats])

        # [NEW] Arrange tab
        arr_btn.click(do_arrange,
            [arr_id, arr_op, arr_a, arr_b, arr_coll],
            [arr_audio, arr_status, lib, stats])
        st_btn.click(do_stitch,
            [st_a, st_b, st_xf, arr_coll],
            [st_audio, st_status, lib, stats])

        # [NEW] Split Stems tab
        sp_btn.click(do_split_stems, [sp_id, sp_coll], [sp_status, lib, stats])

        # ── EDIT STUDIO wiring ──
        # ✏️ Edit in Library -> load into Edit Studio + jump to that tab
        def _open_editor(track_id):
            tid, audio, cover, header, vers = edit_load(track_id)
            return (tid, audio, cover, header, vers,
                    gr.Tabs(selected="edit"))
        edit_btn.click(_open_editor, sel_id,
            [e_id, e_audio, e_cover, e_header, e_versions, main_tabs])

        e_dupe.click(edit_duplicate, e_id,
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])
        e_reload.click(edit_reload, e_id,
            [e_id, e_audio, e_cover, e_header, e_versions])

        e_fx_name.change(update_effect_params, e_fx_name, [e_fx1, e_fx2, e_fx3])
        e_fx_btn.click(edit_effect, [e_id, e_fx_name, e_fx1, e_fx2, e_fx3],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        e_arr_btn.click(edit_arrange, [e_id, e_arr_op, e_arr_a, e_arr_b],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        e_ext_btn.click(edit_extend,
            [e_id, e_ext_prompt, e_ext_dur, e_ext_model, gr.State(3)],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        e_lay_btn.click(edit_add_layer,
            [e_id, e_lay_inst, e_lay_blend, e_lay_vol, gr.State("small"), gr.State(3)],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])
        e_lay_drums.click(lambda t: edit_add_layer(t, "punchy drums, crisp hi-hats", "smart", 0.7, "small", 3),
            e_id, [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])
        e_lay_bass.click(lambda t: edit_add_layer(t, "deep sub bassline", "smart", 0.7, "small", 3),
            e_id, [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])
        e_lay_keys.click(lambda t: edit_add_layer(t, "warm piano keys, melodic", "smart", 0.7, "small", 3),
            e_id, [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        e_split_btn.click(edit_split, e_id,
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])
        e_exp_btn.click(do_export, [e_id, e_exp_platform], [e_exp_file, e_status])

        # ⚡ Quick presets
        # 🎯 Region Editor
        e_reg_preview_btn.click(
            region_preview,
            [e_id, e_reg_start, e_reg_end],
            [e_reg_audio, e_reg_waveform, e_reg_info])
        e_reg_replace_btn.click(
            region_replace_handler,
            [e_id, e_reg_start, e_reg_end, e_reg_prompt,
             e_reg_model, e_reg_guidance, e_reg_xfade],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        _ES = [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats]
        e_preset_bass.click(edit_bass_boost, e_id, _ES)
        e_preset_lofi.click(edit_lofi_preset, e_id, _ES)
        e_preset_master.click(edit_stream_master, e_id, _ES)
        e_normalize_btn.click(edit_normalize, e_id, _ES)
        e_cut_silence_btn.click(edit_cut_silence, e_id, _ES)

        # 🎵 Pitch & Speed
        e_pitch_btn.click(edit_pitch_shift, [e_id, e_pitch_slider], _ES)
        e_speed_btn.click(edit_speed_change, [e_id, e_speed_slider], _ES)

        # 🌅 Fade
        e_fade_btn.click(edit_fade, [e_id, e_fade_in, e_fade_out], _ES)

        # ↔️ Stereo Widen
        e_width_btn.click(edit_stereo_widen, [e_id, e_width_slider], _ES)

        # ✏️ Tweak in Edit Studio
        e_tweak_btn.click(edit_tweak,
            [e_id, e_tweak, e_tweak_keep, e_tweak_model],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        # 🔄 Revamp into our own melody (Groq)
        def _e_revamp(track_id, direction, model, progress=gr.Progress()):
            r = do_revamp(track_id, direction, model, 4, progress=progress)
            new_id = _last_id_from_status(r[1]) or track_id
            tid, audio, cover, header, vers = edit_load(new_id)
            return tid, audio, cover, header, vers, r[1], refresh_library(), _stats_html()
        e_revamp_btn.click(_e_revamp, [e_id, e_revamp_dir, e_tweak_model],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        # 🎼 Song Builder
        sb_set.click(song_set_base, sb_base, [sb_msg, sb_table])
        sb_add.click(song_add_section, [sb_base, sb_role, sb_dur, sb_tweak],
                     [sb_msg, sb_table])
        sb_clear.click(song_clear, outputs=[sb_msg, sb_table])
        sb_build.click(song_build, [sb_model, sb_guid],
                       [sb_audio, sb_status, lib, stats])

        # 🎼 Finish Song inside Edit Studio (uses the currently-edited track)
        def _e_sb_add(track_id, role, dur, tweak):
            # ensure base is the track being edited, then add the section
            if not _song_sections or _song_sections[0]["base_id"] != int(track_id or 0):
                song_set_base(track_id)
            msg, table = song_add_section(track_id, role, dur, tweak)
            return msg, table
        e_sb_add.click(_e_sb_add, [e_id, e_sb_role, e_sb_dur, e_sb_tweak],
                       [e_status, e_sb_table])
        e_sb_clear.click(song_clear, outputs=[e_status, e_sb_table])

        def _e_sb_build(track_id, model):
            r = song_build(model, 4)
            new_id = _last_id_from_status(r[1]) or track_id
            tid, audio, cover, header, vers = edit_load(new_id)
            return tid, audio, cover, header, vers, r[1], refresh_library(), _stats_html()
        e_sb_build.click(_e_sb_build, [e_id, e_tweak_model],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

        # 🎼 one-click auto-finish (the real "finish the song")
        def _e_autofinish(track_id, model, progress=gr.Progress()):
            r = auto_finish(track_id, model, 4, progress=progress)
            new_id = _last_id_from_status(r[1]) or track_id
            tid, audio, cover, header, vers = edit_load(new_id)
            return tid, audio, cover, header, vers, r[1], refresh_library(), _stats_html()
        e_autofinish.click(_e_autofinish, [e_id, e_tweak_model],
            [e_id, e_audio, e_cover, e_header, e_versions, e_status, lib, stats])

    return app


if __name__ == "__main__":
    print("Starting AI Music Studio (pro)…")
    print(f"Output: {os.path.abspath(engine.OUT_DIR)}")
    build().launch(server_port=7860, share=False, inbrowser=True,
                   theme=THEME, css=CSS, js=SHORTCUTS_JS)
