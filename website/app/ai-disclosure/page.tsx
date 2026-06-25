import type { Metadata } from "next";
import { LegalShell, H2, P } from "../_shared/ui";

export const metadata: Metadata = {
  title: "AI Disclosure — StemAI",
  description: "How StemAI uses AI, which models it runs, and the data those models were trained on.",
};

export default function AIDisclosure() {
  return (
    <LegalShell title="AI Disclosure" updated="June 2026">
      <P>
        StemAI uses generative artificial intelligence to create and process
        audio. We believe in being transparent about how that works, what models
        run inside the app, and the data behind them. This page is also intended
        to support transparency obligations such as California&rsquo;s Generative
        AI Training Data Transparency Act (AB 2013).
      </P>
      <P>
        <strong>Important:</strong> StemAI does not train its own AI models. It
        runs pre-trained, third-party models locally on your device. We did not
        create their training datasets and do not have independent access to them.
        The information below summarizes what the model developers have publicly
        stated about their data; for authoritative and current details, see each
        model&rsquo;s own documentation, which we link to.
      </P>

      <H2>Where the AI runs</H2>
      <P>
        All music generation and stem separation runs locally on your computer.
        Your prompts and audio are not sent to us. The one exception is the
        optional &ldquo;Producer&rdquo; assistant: if you supply your own
        third-party API key, the text you type to it is sent to that provider. See
        the <a href="/privacy">Privacy Policy</a> for details.
      </P>

      <H2>Music generation &mdash; Stable Audio 3</H2>
      <P>
        StemAI&rsquo;s text-to-music engine is <strong>Stable Audio 3 Small</strong>{" "}
        by Stability AI (<code>stabilityai/stable-audio-3-small-music</code>),
        running locally on your device. It is provided under the{" "}
        <strong>Stability AI Community License</strong>, which permits commercial
        use for individuals and organizations under US $1,000,000 in annual
        revenue. Stability AI states the model was trained on{" "}
        <strong>licensed and Creative Commons data</strong> &mdash; audio licensed
        from AudioSparx and Creative Commons recordings from Freesound (CC-0,
        CC-BY, CC-Sampling+), with copyrighted material identified and removed. It
        also uses a T5Gemma text encoder, provided under the Gemma Terms of Use.
        See the{" "}
        <a href="https://stability.ai/license" target="_blank" rel="noreferrer">
          Stability AI Community License
        </a>{" "}
        and the{" "}
        <a href="https://huggingface.co/stabilityai/stable-audio-3-small-music" target="_blank" rel="noreferrer">
          model card
        </a>{" "}
        for authoritative license and training-data details. <strong>Powered by
        Stability AI.</strong>
      </P>

      <H2>Stem separation &mdash; Demucs</H2>
      <P>
        To split a song into stems (vocals, drums, bass, and more), StemAI uses
        Meta&rsquo;s Demucs (<code>htdemucs_6s</code>), released under the MIT
        license. Demucs was trained on music-source-separation datasets such as
        MUSDB18 together with additional training tracks, as described by its
        authors. See the{" "}
        <a href="https://github.com/facebookresearch/demucs" target="_blank" rel="noreferrer">
          Demucs documentation
        </a>.
      </P>

      <H2>Producer assistant &mdash; optional third-party LLM</H2>
      <P>
        If you enable the optional Producer assistant with your own API key, your
        requests are interpreted by that provider&rsquo;s large language model
        (for example, models served by Groq). That provider&rsquo;s training data
        and terms are governed by the provider, not by StemAI. Without a key, the
        assistant uses a simple offline keyword interpreter and no external model.
      </P>

      <H2>What this means for your output</H2>
      <P>
        Because Stable Audio 3 is provided under the Stability AI Community License
        and trained on licensed and Creative Commons data, you may use the music
        you generate commercially &mdash; you own your outputs and can distribute
        and monetize them &mdash; provided you stay within the license&rsquo;s terms
        (notably the US $1,000,000 annual-revenue threshold, above which an
        Enterprise license applies). You remain responsible for ensuring your
        prompts and any audio you import do not infringe others&rsquo; rights. Our{" "}
        <a href="/terms">Terms of Service</a> explain your responsibilities in
        full. We update this page when we add or substantially change a model.
      </P>

      <H2>Personal information in training data</H2>
      <P>
        StemAI does not add your personal information to any AI training data, and
        we do not use your prompts or audio to train models. Whether a third-party
        model&rsquo;s original training data contained personal information is a
        matter for that model&rsquo;s developer; refer to the linked model
        documentation above.
      </P>
    </LegalShell>
  );
}
