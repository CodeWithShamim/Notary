import { useQuery } from '@tanstack/react-query';
import { fetchProtocol, fetchStatus } from '../lib/api.js';
import { human, shortAddr, when } from '../lib/format.js';
import { useMeta } from '../lib/meta.js';

export function AgentStatus() {
  useMeta({
    title: 'Agent status',
    description:
      'Live status of the @notary escrow agent — protocol parameters, open deals, and settled escrow volume on Unicity testnet2.',
  });
  const { data: status, isError } = useQuery({ queryKey: ['status'], queryFn: fetchStatus });
  const { data: protocol } = useQuery({ queryKey: ['protocol'], queryFn: fetchProtocol, refetchInterval: false });

  return (
    <div>
      <div className="spread">
        <h1>The agent</h1>
        <span className={`badge ${isError ? 'offline' : 'online'}`}>{isError ? '● unreachable' : '● online'}</span>
      </div>
      <p className="sub">
        Everything below is read from the agent's public, read-only API. There are no write endpoints - all
        state changes travel over the network itself (DMs, payment requests, group chat). That's the point.
      </p>

      {status && (
        <>
          <div className="grid3">
            <div className="stat">
              <div className="v">@{status.identity.nametag}</div>
              <div className="k">nametag</div>
            </div>
            <div className="stat">
              <div className="v sm" title={status.identity.directAddress ?? ''}>
                <code>{shortAddr(status.identity.directAddress, 14)}</code>
              </div>
              <div className="k">DIRECT address</div>
            </div>
            <div className="stat">
              <div className="v">{Math.floor(status.uptimeSec / 3600)}h {Math.floor((status.uptimeSec % 3600) / 60)}m</div>
              <div className="k">uptime</div>
            </div>
          </div>

          <div className="grid2 mt-lg">
            <div className="card">
              <h2>Deals by state</h2>
              {Object.keys(status.dealsByState).length === 0 ? (
                <p className="muted">No deals yet - be the first.</p>
              ) : (
                <table className="clean">
                  <tbody>
                    {Object.entries(status.dealsByState).map(([s, n]) => (
                      <tr key={s}>
                        <td><span className={`badge ${s}`}>{s.replace(/_/g, ' ')}</span></td>
                        <td className="num">{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {status.escrowVolume.length > 0 && (
                <p className="muted mt-md">
                  Escrowed volume: {status.escrowVolume.map((v) => `${human(v.total)} ${v.symbol ?? v.coinId.slice(0, 8)}`).join(' · ')}
                </p>
              )}
            </div>

            <div className="card">
              <h2>Treasury</h2>
              <table className="clean">
                <thead>
                  <tr><th>Asset</th><th className="num">Balance</th></tr>
                </thead>
                <tbody>
                  {status.treasury.assets.map((a) => (
                    <tr key={a.coinId}>
                      <td>{a.symbol}</td>
                      <td className="num">{human(a.total, a.decimals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted mt-md">
                Fee: {status.feeBps / 100}% (disputes {status.disputeFeeBps / 100}%).
                {status.treasury.lastRun && <> Treasury loop last ran {when(status.treasury.lastRun)}.</>}
                {status.lastRebalance ? (
                  <> Last rebalance intent: <code>{String(status.lastRebalance['intentId'] ?? '')}</code></>
                ) : (
                  <> No rebalance needed yet.</>
                )}
              </p>
            </div>
          </div>

          <div className="card mt-lg">
            <h2>Timers</h2>
            <p className="muted">
              Accept within {status.timers.acceptTimeoutMs / 3_600_000}h · fund within {status.timers.fundingTimeoutMs / 3_600_000}h ·
              default delivery window {status.timers.defaultDeliveryHours}h · confirm within {status.timers.confirmTimeoutMs / 3_600_000}h
              (silence = acceptance). Timeouts settle autonomously.
            </p>
          </div>
        </>
      )}

      <div className="card mt-lg">
        <h2>Wire protocol (for builders)</h2>
        <p className="muted">
          Integrate your own agent: send NIP-17 encrypted JSON DMs to <code>@{status?.identity.nametag ?? 'notary'}</code>.
          This reference is served machine-readable at <code>/api/protocol</code>.
        </p>
        {protocol ? <pre className="json">{JSON.stringify(protocol, null, 2)}</pre> : <span className="spinner" />}
      </div>
    </div>
  );
}
