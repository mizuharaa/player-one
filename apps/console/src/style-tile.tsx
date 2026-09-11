import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './styles/discover.css';
import { AssemblyLogo } from './components/logo-animation/AssemblyLogo.tsx';

const root = document.getElementById('root');
if (root) createRoot(root).render(
  <main className="discover-page discover-tile">
    <header className="discover-tile-header"><span className="discover-brand"><AssemblyLogo className="discover-assembly-logo" title="PlayerOne"/></span><p>Assembly · film · people</p><a href="/discover">Open the working page ↗</a></header>
    <p className="discover-eyebrow">Everyday work, seen from within</p>
    <h1 className="discover-display">Việc quen thuộc.<br/>Góc nhìn mới.</h1>
    <p className="discover-lead">Ghi lại hoạt động thường ngày với camera Ego. Nhận tiền cho số phút hữu ích được con người duyệt và chấp nhận.</p>
    <div className="discover-tile-specimens"><section><h2>Material</h2><div className="discover-swatches">{['paper','ink','light','soft'].map(role => <div key={role}><span style={{background:`var(--discover-${role})`}}/><p>{role}</p></div>)}</div></section><section><h2>Typography</h2><p className="discover-tile-type">Archivo Variable</p><p>Tiếng Việt: ă â đ ê ô ơ ư · ế ộ ữ</p><p lang="zh">日常技能，新的视角。</p><p>Body & controls · Be Vietnam Pro</p></section></div>
    <div className="discover-actions"><a className="discover-button" href="/discover#demo">Khám phá bản demo <span aria-hidden="true">↗</span></a><a className="discover-text-link" href="/login">Đăng nhập console ↗</a></div>
    <section className="discover-aperture-section discover-tile-bold-scene"><div className="discover-aperture-copy"><p className="discover-eyebrow">VNG PT Lab × PaXini</p><h2 className="discover-heading">Việc quen thuộc. Góc nhìn của bạn.</h2><p className="discover-lead">An ink/lavender aperture introduces the recorded perspective. Frame corners belong to the image; no fabricated telemetry.</p></div><div className="discover-aperture-field"><div className="discover-aperture"><div className="discover-aperture-view"><img src="/discover-media/20260909/pov-landscape.webp" alt="Illustrative first-person clothing activity"/><span className="discover-frame-corners" aria-hidden="true"/></div><p className="discover-aperture-label">AI-generated first-person illustration</p></div></div></section>
    <section className="discover-review-theatre"><div className="discover-review-screen"><img src="/discover-media/20260909/work-wide.webp" alt="AI-generated illustration of a person washing greens, not an actual collector" width={1920} height={1086}/><p className="discover-lead">Independent people, places and actions. Illustrative scenes, never a fabricated participant roster.</p></div><div className="discover-review-direction"><h2 className="discover-heading">A person reviews every recording.</h2><p className="discover-lead">Lime belongs to this scene ground. Verdict colours remain attached to their actual shaped controls.</p></div></section>
    <footer>Editable direction sample. Token source: packages/design/src/tokens.ts. Not a production acceptance report.</footer>
  </main>,
);
