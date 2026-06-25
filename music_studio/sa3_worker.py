"""
Stable Audio 3 worker — runs INSIDE the isolated sa3_env (its own torch).

Why a separate process: SA3 needs a different torch build than the main app's
music_env, so it can't share the API server's interpreter. engine.py shells out
to this script via sa3_env's python, passes a prompt + params as argv/JSON, and
reads back the path to a generated WAV. Keeps the two dependency worlds apart.

Usage (called by stableaudio3_engine.py, not by hand):
  sa3_env/bin/python -m music_studio.sa3_worker '<json params>'
JSON params: {prompt, duration, steps, seed, out_path}
Prints a single line: OK <out_path>  on success, or  ERR <message>  on failure.
"""
import sys, json, os


def main():
    try:
        params = json.loads(sys.argv[1])
    except Exception as e:
        print(f"ERR bad params: {e}", flush=True)
        return 1

    prompt = params["prompt"]
    duration = float(params.get("duration", 30))
    steps = int(params.get("steps", 8))
    cfg_scale = float(params.get("cfg_scale", 1.0))
    # Locked to "pingpong". The rf denoiser also supports "euler", but it sounded
    # noticeably worse in testing, so it's not offered. (Param kept for plumbing.)
    sampler = "pingpong"
    seed = params.get("seed")
    out_path = params["out_path"]

    # inpaint mode: regenerate a region of an existing audio file
    inpaint_audio_path = params.get("inpaint_audio_path")
    inpaint_start = params.get("inpaint_start")
    inpaint_end = params.get("inpaint_end")
    xfade = float(params.get("xfade", 0.25))

    try:
        import torch, soundfile as sf
        from einops import rearrange
        from stable_audio_tools import get_pretrained_model
        from stable_audio_tools.inference.generation import generate_diffusion_cond_inpaint

        if seed is not None and int(seed) >= 0:
            torch.manual_seed(int(seed))

        device = "mps" if torch.backends.mps.is_available() else "cpu"

        model, cfg = get_pretrained_model("stabilityai/stable-audio-3-small-music")
        sr = cfg["sample_rate"]
        sample_size = cfg["sample_size"]
        model = model.to(device)

        conditioning = [{"prompt": prompt, "seconds_total": float(duration)}]

        if inpaint_audio_path and inpaint_start is not None and inpaint_end is not None:
            # ── inpaint mode: mask a region and let SA3 refill it ──
            src_audio, src_sr = sf.read(inpaint_audio_path, dtype="float32", always_2d=True)
            # SA3 wants [channels, samples] as a torch tensor
            src_tensor = torch.from_numpy(src_audio.T).float()  # (C, N)
            # apg_scale=0.0: vanilla CFG avoids MPS float64 crash (see comment in normal path)
            out = generate_diffusion_cond_inpaint(
                model, steps=steps, cfg_scale=cfg_scale, apg_scale=0.0,
                conditioning=conditioning,
                sample_size=sample_size, sampler_type=sampler, device=device,
                inpaint_audio=(src_sr, src_tensor),
                inpaint_mask_start_seconds=float(inpaint_start),
                inpaint_mask_end_seconds=float(inpaint_end),
            )
        else:
            # ── normal generation mode ──
            # apg_scale=0.0 selects "vanilla CFG". APG (the default 1.0) uses float64
            # in apg_project, which MPS (Apple GPU) can't do — so any cfg_scale != 1.0
            # would crash on Mac. Vanilla CFG gives proper prompt-strength control with
            # no float64, so the Variation slider works on Apple Silicon.
            out = generate_diffusion_cond_inpaint(
                model, steps=steps, cfg_scale=cfg_scale, apg_scale=0.0,
                conditioning=conditioning,
                sample_size=sample_size, sampler_type=sampler, device=device,
            )

        out = rearrange(out, "b d n -> d (b n)")
        out = out.to(torch.float32).div(torch.max(torch.abs(out))).clamp(-1, 1).cpu().numpy()
        # trim to requested duration (model generates a fixed sample_size)
        n = int(duration * sr)
        if out.shape[1] > n:
            out = out[:, :n]
        sf.write(out_path, out.T, sr)   # (frames, channels)
        print(f"OK {out_path} {sr}", flush=True)
        return 0
    except Exception as e:
        import traceback
        print(f"ERR {e}", flush=True)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
