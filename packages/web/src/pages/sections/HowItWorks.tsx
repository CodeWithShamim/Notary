import { Reveal } from './Reveal.js';

export function HowItWorks() {
  return (
    <section className="lp-section">
      <Reveal from="up">
        <div className="lp-head">
          <span className="lp-kicker">how it works</span>
          <h2 className="lp-h2">Three steps, zero trust.</h2>
          <p className="lp-lede">
            You never hand your money to a person. The agent takes custody, watches the deal, and
            settles it itself - you just say what happened.
          </p>
        </div>
      </Reveal>
      <div className="lp-steps">
        <Reveal from="left">
          <article className="lp-step">
            <div className="lp-step-num">01</div>
            <h3 className="lp-step-title">Open &amp; fund</h3>
            <p className="lp-step-body">
              Describe the deal and name the seller. When they accept, the notary DMs you a payment
              request - one click moves your funds into escrow, and the seller sees the money is real
              before doing the work.
            </p>
          </article>
        </Reveal>
        <Reveal from="up" delay={90}>
          <article className="lp-step">
            <div className="lp-step-num">02</div>
            <h3 className="lp-step-title">Deliver</h3>
            <p className="lp-step-body">
              The seller marks the deal delivered (optionally with proof). You confirm - or dispute.
              Stay silent past the window and silence counts as acceptance.
            </p>
          </article>
        </Reveal>
        <Reveal from="right" delay={180}>
          <article className="lp-step">
            <div className="lp-step-num">03</div>
            <h3 className="lp-step-title">The agent settles</h3>
            <p className="lp-step-body">
              Release, refund, timeout, dispute - every settlement transfer is initiated by the agent
              itself on-chain. Nobody holds a "release" button, including us.
            </p>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
