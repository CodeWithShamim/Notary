import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../lib/api.js';
import { human } from '../lib/format.js';
import { Hero } from './sections/Hero.js';
import { HowItWorks } from './sections/HowItWorks.js';
import { Architecture } from './sections/Architecture.js';
import { Features } from './sections/Features.js';
import { Faq } from './sections/Faq.js';
import { CtaBand } from './sections/CtaBand.js';
import { Footer } from './sections/Footer.js';

export function Home() {
  const { data: status, isError } = useQuery({ queryKey: ['status'], queryFn: fetchStatus });

  const totalDeals = status ? Object.values(status.dealsByState).reduce((a, b) => a + b, 0) : 0;
  const volume = status?.escrowVolume.length
    ? status.escrowVolume.map((v) => `${human(v.total)} ${v.symbol ?? ''}`.trim()).join(' · ')
    : '0 UCT';

  return (
    <div className="landing">
      <Hero
        online={!isError && (status?.online ?? true)}
        feePct={status ? status.feeBps / 100 : 1}
        nametag={status?.identity.nametag ?? 'notary'}
        stats={{ deals: totalDeals, volume, pools: status?.pools.length ?? 0 }}
      />
      <HowItWorks />
      <Architecture />
      <Features />
      <Faq />
      <CtaBand />
      <Footer />
    </div>
  );
}
