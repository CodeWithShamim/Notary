import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { fetchStatus } from '../lib/api.js';

/**
 * Compact live status pill for the navbar. Shares the `['status']` query cache
 * with the Agent page (same key → one poll, one source of truth), so it turns
 * red the moment the agent stops answering its read-only API and links straight
 * to the full status page.
 */
export function AgentStatusBadge() {
  const { data, isError, isLoading } = useQuery({ queryKey: ['status'], queryFn: fetchStatus });

  const state = isLoading ? 'pending' : isError ? 'offline' : 'online';
  const label = isLoading ? 'checking…' : isError ? 'unreachable' : 'online';

  return (
    <NavLink to="/agent" className="agent-status" title={`Notary agent — ${label}`} aria-label={`Agent status: ${label}`}>
      <span className={`badge ${state} agent-status-pill`}>
        <span className="dot" aria-hidden="true" />
        {data?.identity.nametag ? `@${data.identity.nametag}` : 'Agent'} · {label}
      </span>
    </NavLink>
  );
}
