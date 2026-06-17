# PyInstaller spec — bundles the FastAPI engine + MusicGen/Demucs into a single
# standalone binary so customers don't need Python installed.
#
# Build from the repo root:
#   music_env/bin/python -m PyInstaller desktop/engine.spec --noconfirm
#
# Heavy ML deps (torch, transformers, demucs, audiocraft) pull in lots of
# dynamically-imported submodules + data files PyInstaller can't see by static
# analysis, so we collect them explicitly.

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# Packages whose code + data + dylibs we want fully bundled. MusicGen runs via
# transformers (not audiocraft), so we skip audiocraft/encodec/julius.
_bundle = ["transformers", "torch", "torchaudio", "demucs",
           "soundfile", "librosa", "scipy", "numpy"]

datas, binaries, hiddenimports = [], [], []
for pkg in _bundle:
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception as e:
        print(f"[spec] skip {pkg}: {e}")

# Our own backend + its uvicorn server stack.
hiddenimports += collect_submodules("music_studio")
hiddenimports += ["psutil"]          # required for RAM safety checks in engine.py
hiddenimports += ["imageio_ffmpeg"]  # ships a bundled ffmpeg binary for vocal merge
hiddenimports += ["uvicorn", "uvicorn.logging", "uvicorn.loops.auto",
                  "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto",
                  "uvicorn.lifespan.on", "fastapi", "anyio"]

a = Analysis(
    ["entry.py"],
    pathex=[".."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "gradio"],  # not needed in the API build
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="stemai-engine",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)
coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False,
    name="stemai-engine",
)
