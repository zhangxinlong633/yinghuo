import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark">DTN</span>
        <span>
          <strong>DELAY TOLERANT</strong>
          <em>接触计划</em>
        </span>
      </Link>
      <nav className="topnav">
        <a href="http://127.0.0.1:3101/">Earth</a>
        <a href="http://127.0.0.1:3102/">Mars</a>
      </nav>
    </header>
  );
}
