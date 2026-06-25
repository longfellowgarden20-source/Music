// Thin runtime loader for WebAudioFont (https://github.com/surikov/webaudiofont).
//
// The npm package only ships the *player*; the ~2000 instrument presets live as
// individual JS files on the project's CDN and are fetched on demand. Each file
// defines a global `_tone_<name>` holding the preset. We load the player script
// once, then lazily fetch + decode presets as the user picks them.
//
// Player + data are CC-by-the-upstream-soundfonts (GeneralUser GS / FluidR3),
// loaded straight from the maintainer's GitHub Pages CDN.

const PLAYER_SRC = "https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js";
const DATA_BASE  = "https://surikov.github.io/webaudiofontdata/sound/";

// Minimal shape of the bits of the player we touch.
interface WAFPlayer {
  loader: {
    startLoad(ctx: BaseAudioContext, path: string, name: string): void;
    waitLoad(cb: () => void): void;
  };
  queueWaveTable(
    ctx: BaseAudioContext, target: AudioNode, preset: unknown,
    when: number, pitch: number, duration: number, volume: number,
  ): { cancel?: () => void } | void;
  cancelQueue(ctx: BaseAudioContext): void;
}

declare global {
  interface Window {
    WebAudioFontPlayer?: new () => WAFPlayer;
    [key: string]: unknown; // _tone_<name> globals
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Load the WebAudioFont player script once and return a player instance. */
export async function getWafPlayer(): Promise<WAFPlayer> {
  if (!scriptPromise) scriptPromise = loadScript(PLAYER_SRC);
  await scriptPromise;
  if (!window.WebAudioFontPlayer) throw new Error("WebAudioFontPlayer unavailable");
  return new window.WebAudioFontPlayer();
}

const presetCache = new Map<string, unknown>();

/**
 * Fetch + decode one instrument preset (e.g. "0040_Aspirin_sf2_file"). Resolves
 * with the preset object the player's queueWaveTable expects.
 */
export async function loadPreset(player: WAFPlayer, fileName: string, ctx: BaseAudioContext): Promise<unknown> {
  const varName = "_tone_" + fileName;
  if (presetCache.has(varName)) return presetCache.get(varName);
  await new Promise<void>((resolve) => {
    player.loader.startLoad(ctx, DATA_BASE + fileName + ".js", varName);
    player.loader.waitLoad(() => resolve());
  });
  const preset = window[varName];
  presetCache.set(varName, preset);
  return preset;
}
