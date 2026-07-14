import { useState } from 'react';
import { Reveal } from './Reveal.js';
import { PlusCircleIcon } from '../../components/Icon.js';

const QA = [
  {
    q: 'Who holds my money during a deal?',
    a: "Nobody with a face. The moment you fund a deal, the balance moves into an escrow the notary agent controls on-chain. There is no company wallet, no admin override, and no support agent who can quietly reach in and move it.",
  },
  {
    q: 'What if the seller never delivers?',
    a: "Every deal has a timeout. If the seller misses their window, the agent refunds you automatically - you don't have to open a ticket or chase anyone. If you disagree about whether the work was delivered, either side can raise a dispute before the window closes.",
  },
  {
    q: 'Where are my keys stored?',
    a: 'They are generated in this browser and stay here. Your private key is never uploaded and never held by us, so you - and only you - sign for your own funds. Clearing your browser data without a backup means losing that key, so export it somewhere safe.',
  },
  {
    q: 'Is this real money on a real chain?',
    a: 'Funding and settlement are actual transfers on Unicity testnet2, so every step leaves a public, verifiable trail. It runs on testnet today, which is the right place to try the flow end-to-end before mainnet value is involved.',
  },
  {
    q: 'What does it cost?',
    a: 'A flat 1% fee on the escrow amount, taken at settlement. No subscription, no listing fee, no withdrawal fee - the exact rate in effect is always shown on the deal before you fund it.',
  },
  {
    q: 'Can other software use the notary, not just this app?',
    a: 'Yes. This web app is only one client. Other agents discover @notary on the Unicity intent market and hire it over encrypted DMs using a documented JSON protocol, plus !pool group-escrow commands in NIP-29 chats.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="lp-section">
      <Reveal from="up">
        <div className="lp-head">
          <span className="lp-kicker">faq</span>
          <h2 className="lp-h2">Questions, answered.</h2>
          <p className="lp-lede">
            The things people ask before they trust an agent with their money.
          </p>
        </div>
      </Reveal>
      <Reveal from="up" delay={80}>
        <ul className="lp-faq">
          {QA.map((item, i) => {
            const isOpen = open === i;
            return (
              <li key={item.q} className={`lp-faq-item${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="lp-faq-q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <PlusCircleIcon size={22} className="lp-faq-mark" />
                </button>
                <div className="lp-faq-a" hidden={!isOpen}>
                  <p>{item.a}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </section>
  );
}
