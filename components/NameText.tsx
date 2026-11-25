/**
 * A name a coach typed (a play, playbook, lineup, team, player, organization or member), and the only place
 * a name decides how it shrinks. It wraps, breaking inside a word if it must, so two names that differ only
 * at the end stay apart on every device (3b401ea). `oneLine` keeps it to one line with an ellipsis, for a
 * header or card that must not grow and whose name is shown whole one tap away; its title holds the whole name.
 */
export function NameText({ children, oneLine = false, className = "" }: { children: string; oneLine?: boolean; className?: string }) {
  return oneLine
    ? <span className={`block min-w-0 truncate ${className}`} title={children}>{children}</span>
    : <span className={`min-w-0 whitespace-normal wrap-anywhere ${className}`}>{children}</span>;
}
