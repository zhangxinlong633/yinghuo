'use client';

import type { ContactPlan } from '@/lib/api';

export function ContactTimeline({ plan }: { plan: ContactPlan }) {
  const maxT = plan.maxTimeMs ?? 5000;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / maxT) * 100))}%`;
  const width = (o: number, c: number) =>
    `${Math.max(1, ((c - o) / maxT) * 100)}%`;

  return (
    <div className="panel">
      <div className="legend">
        <span><i className="dot er" /> Earth ↔ Relay</span>
        <span><i className="dot rm" /> Relay ↔ Mars</span>
        <span>横轴：虚拟时间 0 … {maxT} ms（非 ClusterIP 常开链路）</span>
      </div>
      <div className="timeline" aria-label="contact windows">
        {plan.contacts.map((c) => {
          const cls =
            c.a === 'Earth' || c.b === 'Earth' ? 'bar er' : 'bar rm';
          return c.windows.map(([o, cl], i) => (
            <div
              key={`${c.a}-${c.b}-${i}`}
              className={cls}
              style={{ left: pct(o), width: width(o, cl) }}
              title={`${c.a}↔${c.b} [${o}, ${cl}) delay=${c.delayMs}ms`}
            >
              {c.a}↔{c.b} [{o},{cl})
            </div>
          ));
        })}
      </div>
      <div className="axis">
        <span>t=0</span>
        <span>t={Math.floor(maxT / 2)}</span>
        <span>t={maxT}</span>
      </div>
    </div>
  );
}
