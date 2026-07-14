import { useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon } from './Icon.js';

/**
 * Client-side pagination over an in-memory list. Both the deals list and the
 * reputation leaderboard arrive whole, so we page locally rather than over the wire.
 */
export function usePaginated<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  // Clamp the current page when the list shrinks (e.g. live updates, new search).
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageItems = useMemo(
    () => items.slice(page * pageSize, page * pageSize + pageSize),
    [items, page, pageSize],
  );

  return { page, setPage, pageCount, pageItems, pageSize, total: items.length };
}

interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageCount, total, pageSize, onChange }: PaginationProps) {
  if (pageCount <= 1) return null;

  const from = page * pageSize + 1;
  const to = Math.min(total, page * pageSize + pageSize);

  return (
    <div className="pagination">
      <button
        className="btn secondary small"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <span className="btn-ico"><ArrowRightIcon size={15} className="flip-x" /> Prev</span>
      </button>
      <span className="pagination-info muted">
        {from}–{to} of {total}
      </span>
      <button
        className="btn secondary small"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        <span className="btn-ico">Next <ArrowRightIcon size={15} /></span>
      </button>
    </div>
  );
}
