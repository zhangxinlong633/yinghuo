'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ContactPlan,
  RunSummary,
  SavedRun,
  SimulateResult,
  fetchPlan,
  fetchRun,
  fetchRuns,
  runSimulate,
} from '@/lib/api';
import { ContactTimeline } from './ContactTimeline';
import { ReplayPlayer } from './ReplayPlayer';

export function DemoPanel() {
  const [plan, setPlan] = useState<ContactPlan | null>(null);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<SavedRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    fetchRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    fetchPlan()
      .then(setPlan)
      .catch((e: Error) =>
        setError(
          `无法加载接触计划（请先启动 NestJS API：npm run api）。${e.message}`
        )
      );
    loadRuns();
  }, [loadRuns]);

  const onRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await runSimulate();
      setResult(r);
      setPlan(r.plan);
      loadRuns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadRuns]);

  const openRun = useCallback(async (id: string) => {
    if (selected?.id === id) {
      setSelected(null);
      return;
    }
    try {
      setSelected(await fetchRun(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selected?.id]);

  return (
    <>
      <div className="panel row">
        <button type="button" onClick={onRun} disabled={loading || !plan}>
          {loading ? '仿真中…' : '运行 store-and-forward 仿真'}
        </button>
        {result && (
          <span className={`badge ${result.success ? 'ok' : 'fail'}`}>
            {result.success ? 'SUCCESS — 投递完成' : `FAIL — pending=${result.pending}`}
          </span>
        )}
        {result?.runId && (
          <button type="button" className="secondary" onClick={() => void openRun(result.runId!)}>
            在下方回放
          </button>
        )}
        {result && (
          <span className="meta">stores: {JSON.stringify(result.storeSizes)}</span>
        )}
      </div>

      {error && <p className="error panel">{error}</p>}

      {plan && (
        <>
          <h2>接触窗口（Contact Graph）</h2>
          {plan.description && <p className="lead">{plan.description}</p>}
          <ContactTimeline plan={plan} />
          <div className="panel">
            <strong>节点角色与下一跳（静态表，接触打开才转发）</strong>
            <ul className="node-list">
              {plan.nodes.map((n) => (
                <li key={n.name}>
                  {n.name} <span className="role">[{n.role ?? 'hybrid'}]</span>
                  {' : '}
                  {JSON.stringify(n.nextHop)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {result && (
        <>
          <h2>事件时间线</h2>
          <div className="panel events">
            {result.events.map((ev, i) => (
              <div className="ev" key={`${ev.t}-${ev.event}-${i}`}>
                <span className="t">[t={String(ev.t).padStart(6)}ms]</span>{' '}
                <span className="e">{ev.event}</span>{' '}
                <span className="n">@{ev.node}</span> {ev.msg}
              </div>
            ))}
          </div>
        </>
      )}

      <h2>已保存的运行</h2>
      <div className="panel">
        {runs.length === 0 && <p className="lead">还没有保存的运行。先跑一次仿真。</p>}
        {runs.length > 0 && (
          <ul className="run-list">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={'run-pick' + (selected?.id === r.id ? ' active' : '')}
                  onClick={() => void openRun(r.id)}
                >
                  <span className={`badge ${r.success ? 'ok' : 'fail'}`}>
                    {r.success ? 'OK' : 'FAIL'}
                  </span>{' '}
                  <strong>{r.summary}</strong>
                  <br />
                  <span className="run-meta">
                    {r.createdAt} · {r.eventCount} events · maxT={r.maxTimeMs}ms
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && <ReplayPlayer run={selected} />}
    </>
  );
}
