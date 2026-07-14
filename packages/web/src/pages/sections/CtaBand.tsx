import { Link } from 'react-router-dom';
import { Reveal } from './Reveal.js';

export function CtaBand() {
  return (
    <section className="lp-cta">
      <Reveal from="up">
        <div className="lp-modal">
          {/* animated gradient ring that sits behind the glass */}
          <span className="lp-modal-ring" aria-hidden="true" />
          <div className="lp-modal-glass">
            {/* modal titlebar — reads like a web3 connect dialog */}
            <div className="lp-modal-bar">
              <span className="lp-modal-dots" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span className="lp-modal-tag">
                <i className="lp-modal-live" /> notary.agent
              </span>
              <span className="lp-modal-net" aria-hidden="true">unicity · mainnet</span>
            </div>

            <div className="lp-modal-body">
              <h2 className="lp-modal-title">
                Settle your next deal <span className="grad">without trusting anyone.</span>
              </h2>
              <p className="lp-modal-sub">
                Open a deal in under a minute. The agent holds the funds and settles it — you never
                hand custody to a person.
              </p>

              <div className="lp-cta-row">
                <Link to="/new" className="lp-btn lp-btn-primary">
                  Open a deal <span aria-hidden>→</span>
                </Link>
                <Link to="/deals" className="lp-btn lp-btn-ghost">
                  View my deals
                </Link>
              </div>

              <div className="lp-modal-trust" aria-hidden="true">
                <span className="lp-modal-chip"><i className="lp-modal-tick" /> Non-custodial</span>
                <span className="lp-modal-chip"><i className="lp-modal-tick" /> On-chain proof</span>
                <span className="lp-modal-chip"><i className="lp-modal-tick" /> 1% flat fee</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
