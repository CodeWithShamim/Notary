import { Link } from 'react-router-dom';
import { Reveal } from './Reveal.js';

export function CtaBand() {
  return (
    <section className="lp-cta">
      <Reveal from="up">
        <div className="lp-cta-card">
          <div className="lp-aurora lp-aurora-soft" aria-hidden="true" />
          <h2 className="lp-cta-title">Settle your next deal without trusting anyone.</h2>
          <p className="lp-cta-sub">Open a deal in under a minute. The agent takes it from there.</p>
          <div className="lp-cta-row">
            <Link to="/new" className="lp-btn lp-btn-primary">
              Open a deal <span aria-hidden>→</span>
            </Link>
            <Link to="/deals" className="lp-btn lp-btn-ghost">
              View my deals
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
