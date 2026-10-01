'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SavedRun } from '@/lib/api';
import { ContactTimeline } from './ContactTimeline';

const PLAY_SPEED = 4; // sim-ms per real-ms (4× realtime)

export function ReplayPlayer({ run }: { run: SavedRun }) {
  const maxT = run.maxTimeMs || Math.max(0, ...run.events.map((e) => e.t), 1);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const tRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastWallRef = useRef<number>(0);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const visible = useMemo(
    () => run.events.filter((e) => e.t <= t),
    [run.events, t]
  );

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    lastWallRef.current = 0;

    const loop = (now: number) => {
      if (!playingRef.current) return;
      if (!lastWallRef.current) lastWallRef.current = now;
      const dt = now - lastWallRef.current;
      lastWallRef.current = now;
      const next = Math.min(maxT, tRef.current + dt * PLAY_SPEED);
      tRef.current = next;
      setT(next);
      if (next >= maxT) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, maxT]);

  return (
    <>
      <div className="panel">
        <p className="lead" style={{ marginBottom: '0.75rem' }}>
          {run.summary}
          <br />
          <span className="meta">
            id={run.id} · createdAt={run.createdAt} · roles={JSON.stringify(run.roles)}
          </span>
        </p>
        <span className={`badge ${run.success ? 'ok' : 'fail'}`}>
          {run.success ? 'SUCCESS' : `FAIL pending=${run.pending}`}
        </span>{' '}
        <span className="meta">
          stores: {JSON.stringify(run.storeSizes)}
        </span>
      </div>

      <h2>接触窗口</h2>
      <ContactTimeline plan={run.plan} />

      <h2>回放控制</h2>
      <div className="panel">
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <button type="button" onClick={() => setPlaying((p) => !p)}>
            {playing ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setPlaying(false);
              setT(0);
              tRef.current = 0;
            }}
          >
            重置
          </button>
          <span className="meta">
            t = {Math.round(t)} / {maxT} ms · 已显示 {visible.length}/{run.events.length} 事件
          </span>
        </div>
        <input
          className="scrub"
          type="range"
          min={0}
          max={maxT}
          step={1}
          value={Math.min(t, maxT)}
          onChange={(e) => {
            setPlaying(false);
            const v = Number(e.target.value);
            tRef.current = v;
            setT(v);
          }}
          aria-label="scrub timeline"
        />
        <div className="axis" style={{ marginTop: '0.35rem' }}>
          <span>t=0</span>
          <span>t={Math.floor(maxT / 2)}</span>
          <span>t={maxT}</span>
        </div>
      </div>

      <h2>事件流（t ≤ 当前）</h2>
      <div className="panel events">
        {visible.length === 0 && (
          <div className="ev" style={{ color: 'var(--muted)' }}>
            拖动滑块或点击播放以显示事件…
          </div>
        )}
        {visible.map((ev, i) => (
          <div
            className={`ev ${i === visible.length - 1 ? 'ev-latest' : ''}`}
            key={`${ev.t}-${ev.event}-${i}`}
          >
            <span className="t">[t={String(ev.t).padStart(6)}ms]</span>{' '}
            <span className="e">{ev.event}</span>{' '}
            <span className="n">@{ev.node}</span> {ev.msg}
          </div>
        ))}
      </div>
    </>
  );
}
