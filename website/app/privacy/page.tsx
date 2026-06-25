import type { Metadata } from "next";
import { LegalShell, H2, P } from "../_shared/ui";

export const metadata: Metadata = {
  title: "Privacy Policy — StemAI",
  description: "How StemAI handles your data. The app runs on your machine; we collect only what is needed to sell and support it.",
};

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="June 2026">
      <P>
        This Privacy Policy explains what personal information StemAI
        (&ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, why, and the choices you
        have. StemAI is built privacy-first: the desktop application runs on your
        own computer, and the music you make stays on your machine. The limited
        data we do handle relates mainly to selling, licensing, and supporting the
        product.
      </P>
      <P>
        This policy is written to meet the disclosure requirements of the
        California Consumer Privacy Act, as amended by the California Privacy
        Rights Act (collectively, the &ldquo;CCPA&rdquo;), and the comparable
        consumer-privacy laws now in effect in states including Virginia,
        Colorado, Connecticut, Texas, Oregon, Montana, and others. Where those
        laws use different names for the same right, we honor the broadest
        version available to you.
      </P>

      <H2>What the app collects</H2>
      <P>
        The core of StemAI &mdash; music generation, stem separation, and the DAW
        &mdash; runs entirely offline on your device. Your prompts, imported
        audio, and generated tracks are processed locally and are{" "}
        <strong>not transmitted to us</strong>. There is no account and no usage
        analytics inside the application.
      </P>

      <H2>Optional AI assistant (&ldquo;Producer&rdquo;) keys</H2>
      <P>
        StemAI includes an optional &ldquo;Producer&rdquo; assistant that can
        interpret natural-language requests. If, and only if, you choose to add
        your own third-party AI provider key (for example, a Groq API key), the
        text of the requests you send to that assistant is transmitted to that
        provider so it can return a response. This is entirely optional and off by
        default. Your key is stored locally on your machine, is never sent to us,
        and is used only to talk to the provider you chose. Your use of that
        provider is governed by <em>their</em> privacy policy and terms. Without a
        key, the assistant runs on a built-in offline keyword interpreter and
        sends nothing anywhere.
      </P>

      <H2>What the website &amp; checkout collect</H2>
      <P>
        When you purchase StemAI, our payment processor (Stripe) collects the
        information needed to complete the transaction, including your name,
        email, and payment details. We receive your email address and order
        details so we can deliver your license key and download link and provide
        support. We do <strong>not</strong> store full payment-card numbers; those
        are handled directly by Stripe under its own security and privacy terms.
      </P>

      <H2>Categories of personal information we collect</H2>
      <P>
        For the purposes of the CCPA, in the past 12 months we have collected the
        following categories of personal information, all in connection with sales
        and support rather than from use of the app itself:
      </P>
      <P>
        <strong>Identifiers</strong> (name, email address, order/license
        identifiers); <strong>commercial information</strong> (products purchased
        and transaction history); and <strong>limited internet activity</strong>{" "}
        on the marketing website (such as IP address and pages viewed, via
        essential logs). We do not knowingly collect sensitive personal
        information, and we do not collect personal information from individuals we
        know to be under 16.
      </P>

      <H2>Why we collect it (purposes)</H2>
      <P>
        To process your purchase, deliver and activate your license, provide
        customer support, prevent fraud and abuse, comply with legal obligations
        (such as tax and accounting), and maintain the security of our website.
      </P>

      <H2>Who we share it with</H2>
      <P>
        We share personal information only with service providers acting on our
        behalf under contract: our payment processor (Stripe), our email/support
        provider, and our hosting/download infrastructure. We may also disclose
        information where required by law. We do <strong>not sell</strong> your
        personal information, and we do <strong>not share</strong> it for
        cross-context behavioral advertising, as those terms are defined under the
        CCPA. We have not done so in the preceding 12 months.
      </P>

      <H2>How long we keep it</H2>
      <P>
        We retain order and license records for as long as needed to support your
        license and meet legal, tax, and accounting requirements (generally up to
        seven years), then delete or anonymize them. Website logs are kept for a
        short period for security and then discarded.
      </P>

      <H2>License activation</H2>
      <P>
        When you activate your license, the app verifies the key once to confirm a
        valid purchase, then stores a signed activation file locally so the app
        works offline afterward. We do not track your usage or &ldquo;phone
        home&rdquo; on every launch.
      </P>

      <H2>Cookies</H2>
      <P>
        The marketing site uses only the essential cookies required for the
        checkout to function. We do not use advertising or cross-site tracking
        cookies, so there is no &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; to opt
        out of.
      </P>

      <H2>Your privacy rights</H2>
      <P>
        Depending on where you live, you have the right to: <strong>know</strong>{" "}
        what personal information we hold about you and how we use it;{" "}
        <strong>access</strong> a copy of it; <strong>correct</strong> inaccurate
        information; <strong>delete</strong> it; and to be free from{" "}
        <strong>discrimination</strong> for exercising these rights. Because we do
        not sell or share personal information or use automated decision-making, no
        opt-out of those activities is necessary. To exercise any right, email us
        at the address on the Support page; we will verify your request using your
        order information and respond within the timeframes required by law
        (generally 45 days). You may use an authorized agent where the law allows.
      </P>

      <H2>Children</H2>
      <P>
        StemAI is not directed to children under 16, and we do not knowingly
        collect their personal information. If you believe a child has provided us
        information, contact us and we will delete it.
      </P>

      <H2>Changes</H2>
      <P>
        If this policy changes, we will update the date at the top of this page,
        and we review it at least every 12 months. Material changes will be noted
        on the site.
      </P>
    </LegalShell>
  );
}
