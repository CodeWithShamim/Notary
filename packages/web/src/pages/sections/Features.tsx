import { Link } from 'react-router-dom';
import { Reveal } from './Reveal.js';
import { KeyIcon, CogIcon, LockIcon, ReceiptIcon, BotIcon, ArrowRightIcon } from '../../components/Icon.js';

export function Features() {
  return (
    <section className="lp-section">
      <Reveal from="up">
        <div className="lp-head">
          <span className="lp-kicker">why notary</span>
          <h2 className="lp-h2">An escrow you don't have to trust.</h2>
          <p className="lp-lede">
            No custodian, no admin with a kill switch, no waiting on support. Just an autonomous agent
            that holds the funds and settles the deal on-chain.
          </p>
        </div>
      </Reveal>
      <div className="lp-features">
        <Reveal from="left">
          <article className="lp-feature">
            <div className="lp-feature-icon"><KeyIcon size={26} /></div>
            <h3 className="lp-feature-title">Non-custodial keys</h3>
            <p className="lp-feature-body">
              Your keys are generated and stay in this browser - never uploaded, never held by us. You
              sign for your own funds, always.
            </p>
          </article>
        </Reveal>
        <Reveal from="right" delay={80}>
          <article className="lp-feature">
            <div className="lp-feature-icon"><CogIcon size={26} /></div>
            <h3 className="lp-feature-title">Autonomous settlement</h3>
            <p className="lp-feature-body">
              Release, refund, timeout and dispute are all initiated by the agent itself. No human
              presses a button to move your escrow.
            </p>
          </article>
        </Reveal>
        <Reveal from="left" delay={160}>
          <article className="lp-feature">
            <div className="lp-feature-icon"><LockIcon size={26} /></div>
            <h3 className="lp-feature-title">Encrypted DMs</h3>
            <p className="lp-feature-body">
              Every instruction, payment request and receipt travels agent-to-agent over end-to-end
              encrypted direct messages.
            </p>
          </article>
        </Reveal>
        <Reveal from="right" delay={240}>
          <article className="lp-feature">
            <div className="lp-feature-icon"><ReceiptIcon size={26} /></div>
            <h3 className="lp-feature-title">On-chain settlement trail</h3>
            <p className="lp-feature-body">
              Funding and settlement are real transfers on Unicity testnet2 - a public, verifiable
              record of exactly what the agent did.
            </p>
          </article>
        </Reveal>
        <Reveal from="up" delay={120} className="span-all">
          <article className="lp-feature lp-feature-wide">
            <div className="lp-feature-icon"><BotIcon size={26} /></div>
            <h3 className="lp-feature-title">Also speaks machine</h3>
            <p className="lp-feature-body">
              The web app is just one client. Other agents discover @notary on the Unicity intent
              market and hire it over encrypted DMs with a documented JSON protocol - plus{' '}
              <code>!pool</code> group-escrow commands in NIP-29 chats.
            </p>
            <Link to="/agent" className="lp-feature-link">
              See the protocol reference <ArrowRightIcon size={15} className="inline-ico" />
            </Link>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
