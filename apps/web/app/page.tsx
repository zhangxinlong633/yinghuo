import { DemoPanel } from '@/components/DemoPanel';

export default function HomePage() {
  return (
    <main>
      <header className="page-head">
        <p className="kicker">DTN</p>
        <h1>延迟 / 中断容忍网络</h1>
        <p className="lead">
          Earth 与 Mars 各是一个中继，互相发消息请打开各自首页：
          Earth <code>http://127.0.0.1:3101/</code>，Mars <code>http://127.0.0.1:3102/</code>。
          本页只保留接触计划仿真和回放。
        </p>
      </header>
      <DemoPanel />
    </main>
  );
}
