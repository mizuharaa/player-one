import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import {useOperatorPlayback} from '../../lib/use-operator-playback';
import {AssemblyLogo} from '../logo-animation/AssemblyLogo';
import '../../styles/discover-operator.css';

const assets='/discover-media/operator-demo/';
const words={
  en:{steps:['Uploaded','Review','Verdict','QR demo','Settled'],demo:'Interactive demo · sample values',title:'Review workspace',queue:'Submission queue',collector:'Collector 024',task:'Prepare a drink',received:'Footage received',file:'Ego camera · right view',review:'Review the footage',criteria:['Task is visible','Hands stay in frame','Usable recording'],verdict:'Accepted',reason:'The activity is visible throughout the selected segment.',effective:'Reviewed effective time',time:'00:18',payment:'Demo settlement',scan:'Scan to preview',qr:'Demo QR only · no payment',confirm:'Simulate confirmation',done:'Settlement completed',receipt:'Example receipt',amount:'Illustrative amount',wallet:'Collector wallet',reference:'Reference',next:'Continue',replay:'Replay demo',pause:'Pause demo',play:'Play demo',unavailable:'Preview unavailable',retry:'Retry video',footnote:'Real sample footage. Review, QR and payment states are illustrative; no money is transferred.',view:'Watch the workflow',balance:'Completed settlements',waiting:'Ready for review'},
  vi:{steps:['Đã tải lên','Duyệt','Kết quả','QR mẫu','Đã chi trả'],demo:'Bản minh họa · số liệu mẫu',title:'Không gian duyệt',queue:'Danh sách bản ghi',collector:'Người thu thập 024',task:'Pha đồ uống',received:'Đã nhận bản ghi',file:'Camera Ego · góc phải',review:'Duyệt bản ghi',criteria:['Thấy rõ hoạt động','Tay nằm trong khung hình','Bản ghi sử dụng được'],verdict:'Chấp nhận',reason:'Hoạt động hiển thị rõ trong đoạn được chọn.',effective:'Thời gian hữu ích đã duyệt',time:'00:18',payment:'Chi trả minh họa',scan:'Quét để xem minh họa',qr:'QR mẫu · không thanh toán',confirm:'Mô phỏng xác nhận',done:'Hoàn tất chi trả',receipt:'Biên nhận mẫu',amount:'Số tiền minh họa',wallet:'Ví người thu thập',reference:'Mã tham chiếu',next:'Tiếp tục',replay:'Xem lại',pause:'Dừng minh họa',play:'Phát minh họa',unavailable:'Không thể tải bản xem trước',retry:'Thử lại video',footnote:'Bản ghi mẫu thực tế. Các bước duyệt, QR và chi trả là minh họa; không chuyển tiền.',view:'Xem quy trình',balance:'Các khoản đã chi trả',waiting:'Sẵn sàng duyệt'},
  zh:{steps:['已上传','审核','结果','二维码演示','已结算'],demo:'交互演示 · 示例数据',title:'审核工作台',queue:'提交队列',collector:'采集员 024',task:'准备饮品',received:'已收到视频',file:'Ego 相机 · 右视角',review:'审核视频',criteria:['任务清晰可见','双手在画面内','录像可用'],verdict:'接受',reason:'所选片段中的活动清晰可见。',effective:'已审核有效时间',time:'00:18',payment:'结算演示',scan:'扫码预览',qr:'仅演示二维码 · 不付款',confirm:'模拟确认',done:'结算完成',receipt:'示例收据',amount:'示例金额',wallet:'采集员钱包',reference:'参考编号',next:'继续',replay:'重播演示',pause:'暂停演示',play:'播放演示',unavailable:'预览不可用',retry:'重试视频',footnote:'真实示例视频。审核、二维码及付款状态仅供演示，不转移资金。',view:'查看流程',balance:'已完成结算',waiting:'等待审核'},
};

const stroke={fill:'none',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round'} as const;

/** Inline marks only — no icon font, no glyph that can lose its encoding. */
const IconUpload=()=><svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.8" aria-hidden="true" {...stroke}><path d="M12 15.5V4m0 0L7.6 8.4M12 4l4.4 4.4"/><path d="M4.2 15v3.1a1.9 1.9 0 0 0 1.9 1.9h11.8a1.9 1.9 0 0 0 1.9-1.9V15"/></svg>;
const IconChevron=()=><svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="2" aria-hidden="true" {...stroke}><path d="m9.5 5 7 7-7 7"/></svg>;
const IconCheck=({size=16}:{size?:number})=><svg viewBox="0 0 24 24" width={size} height={size} strokeWidth="2.6" aria-hidden="true" {...stroke}><path d="m4.5 12.6 5.2 5.2L19.5 6.6"/></svg>;
const IconPanel=()=><svg viewBox="0 0 24 24" width="16" height="16" strokeWidth="1.6" aria-hidden="true" {...stroke}><rect x="3.5" y="5" width="17" height="14" rx="2.6"/><path d="M9.6 5v14"/></svg>;

export function OperatorDemo({motionPaused,reducedMotion}:{motionPaused:boolean;reducedMotion:boolean}){
  const {t,i18n}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const w=words[i18n.language.startsWith('vi')?'vi':i18n.language.startsWith('zh')?'zh':'en'];
  const root=useRef<HTMLElement>(null);const video=useRef<HTMLVideoElement>(null);
  const [step,setStep]=useState(0);const [paused,setPaused]=useState(false);const [visible,setVisible]=useState(false);const [hidden,setHidden]=useState(document.hidden);const [failed,setFailed]=useState(false);
  const running=visible&&!hidden&&!paused&&!motionPaused&&!reducedMotion;
  useEffect(()=>{const node=root.current?.querySelector('.operator-workspace');if(!node)return;const observer=new IntersectionObserver(([entry])=>setVisible(!!entry?.isIntersecting),{threshold:.25});observer.observe(node);const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);return()=>{observer.disconnect();document.removeEventListener('visibilitychange',visibility);};},[]);
  useOperatorPlayback(root,step,running,()=>setStep(s=>(s+1)%5));
  useEffect(()=>{const node=video.current;if(!node)return;if(running&&step<3)void node.play().catch(()=>{});else node.pause();},[running,step]);
  const choose=(index:number)=>{setPaused(true);setStep(index);};
  const action=step===0?w.review:step===1?w.verdict:step===2?w.payment:step===3?w.confirm:w.replay;
  return <section ref={root} id="introduction" className="operator-hero" data-running={running}>
    <div className="operator-pitch">
      <div className="operator-partners" aria-label="VNG PT Lab × PaXini"><span className="operator-vng"><img src={`${assets}vng.png`} alt="VNG"/></span><span className="operator-partner-cross" aria-hidden="true">×</span><span className="operator-paxini"><img src={`${assets}paxini.png`} alt="PaXini"/></span></div>
      <h2>{c('introTitle')}</h2><p>{c('introBody')}</p>
      <button className="operator-watch" onClick={()=>{setStep(0);setPaused(false);root.current?.querySelector('.operator-workspace')?.scrollIntoView({block:'nearest',behavior:reducedMotion?'instant':'smooth'});}}>{w.view}<span aria-hidden="true">↗</span></button>
      <div className="operator-principles">{['Tasks','Review'].map(key=><div key={key}><h3>{c(`product${key}`)}</h3><p>{c(`product${key}Body`)}</p></div>)}</div>
    </div>
    <div className="operator-stage">
      <div className="operator-stage-caption"><span>{w.demo}</span><button onClick={()=>setPaused(p=>!p)} disabled={motionPaused||reducedMotion} aria-label={paused?w.play:w.pause} aria-pressed={paused}>{paused?'▷':'Ⅱ'}</button></div>
      <div className="operator-workspace" data-step={step}>
        <header><span className="operator-traffic-lights" aria-hidden="true"><i/><i/><i/></span><span className="operator-window-title">PlayerOne · {w.title}</span><span className="operator-window-tool"><IconPanel/></span></header>
        <div className="operator-appbar"><AssemblyLogo title="PlayerOne"/><span>{w.demo}</span><span className="operator-avatar">PT</span></div>
        <div className="operator-workspace-body">
          <aside className="operator-rail" aria-hidden="true"><span>▦</span><span className={step<3?'selected':''}>▤</span><span className={step>=3?'selected':''}>↗</span></aside>
          <div className="operator-desk">
            <div className="operator-desk-heading"><div><span>{step<3?w.queue:w.payment}</span><h3>{step<3?w.task:w.collector}</h3></div><span className="operator-status">{w.steps[step]}</span></div>
            <div className="operator-display" data-view={step}>
              <div className="operator-inbox operator-screen" data-active={step===0} inert={step!==0} aria-hidden={step!==0}>
                <div className="operator-inbox-title"><span className="operator-upload-symbol"><IconUpload/></span><h4>{w.received}</h4><span>{w.waiting}</span></div>
                <button className="operator-file-row" data-demo-target="open" onClick={()=>choose(1)}><img src={`${assets}review-poster.webp`} alt=""/><span><strong>{w.task}</strong><small>EGO-003357 · {w.collector}</small></span><b><IconChevron/></b></button>
                <div className="operator-file-meta"><span>{w.file}</span><span>00:18 · MP4</span></div>
                <div className="operator-transfer"><span>{w.received}</span><strong>100%</strong><i/></div>
              </div>
              <div className="operator-review-stage operator-screen" data-active={step===1||step===2} inert={step!==1&&step!==2} aria-hidden={step!==1&&step!==2}>
                <div className="operator-footage"><video ref={video} src={`${assets}review.mp4`} poster={`${assets}review-poster.webp`} muted loop playsInline controls={paused||reducedMotion||motionPaused} aria-label={w.review} preload="metadata" onError={()=>setFailed(true)}/><span className="operator-footage-label"><i/>{w.file}</span><span className="operator-time">00:12 · 00:30</span>{failed&&<div className="operator-video-error"><p>{w.unavailable}</p><button onClick={()=>{setFailed(false);video.current?.load();}}>{w.retry}</button></div>}</div>
                <div className="operator-review-panel" data-verdict={step===2}>
                  <div className="operator-review-checklist"><strong>{w.review}</strong><div className="operator-criteria">{w.criteria.map((label,index)=><span data-demo-target={`criterion-${index}`} style={{'--criterion-index':index+1} as CSSProperties} key={label}><IconCheck size={14}/>{label}</span>)}</div></div>
                  <div className="operator-verdict-panel"><div className="operator-verdict"><span className="operator-check"><IconCheck size={17}/></span><strong>{w.verdict}</strong><span>{w.effective} <b>{w.time}</b></span></div><p>{w.reason}</p></div>
                </div>
              </div>
              <div className="operator-payment operator-screen" data-active={step===3} inert={step!==3} aria-hidden={step!==3}>
                <div className="operator-payment-brand"><img className="operator-zalo" src={`${assets}zalopay.png`} alt="ZaloPay"/><span>{w.payment}</span></div>
                <h4>{w.scan}</h4><div className="operator-qr" data-demo-target="qr"><img src={`${assets}demo-qr.svg`} alt={w.qr}/><i aria-hidden="true"/></div><p>{w.qr}</p><button data-demo-target="confirm" onClick={()=>choose(4)}>{w.confirm}<span aria-hidden="true">→</span></button>
              </div>
              <div className="operator-payment operator-receipt operator-screen" data-active={step===4} inert={step!==4} aria-hidden={step!==4}>
                <div className="operator-payment-brand"><img className="operator-zalo" src={`${assets}zalopay.png`} alt="ZaloPay"/><span>{w.receipt}</span></div>
                <span className="operator-settled-check"><IconCheck size={19}/></span><h4>{w.done}</h4><strong className="operator-amount">+ 12.000 ₫</strong><small>{w.amount}</small><dl><div><dt>{w.wallet}</dt><dd>{w.collector}</dd></div><div><dt>{w.reference}</dt><dd>DEMO-0024</dd></div><div><dt>ZaloPay</dt><dd className="operator-paid">{w.steps[4]}<IconCheck size={13}/></dd></div></dl>
              </div>
            </div>
            <footer><span>{step===4?w.balance:'EGO-003357 · '+w.collector}</span><button data-demo-target="next" onClick={()=>{if(step===4){setStep(0);setPaused(false);}else choose(step+1);}}>{action}<span aria-hidden="true">{step===4?'↺':'→'}</span></button></footer>
          </div>
        </div>
        <div className="operator-cursor" aria-hidden="true"><svg viewBox="0 0 22 30" width="22" height="30"><path d="M2.5 1.5 2.5 24.6 7.9 19.3 11.6 27.9 15.1 26.3 11.5 17.8 18.6 17.8Z" fill="#0b0d10" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/></svg><i/></div>
      </div>
      <nav className="operator-step-nav" aria-label={w.title}>{w.steps.map((label,index)=><button key={label} onClick={()=>choose(index)} aria-current={step===index?'step':undefined}><span>{String(index+1).padStart(2,'0')}</span>{label}</button>)}</nav>
      <p className="operator-disclosure">{w.footnote}</p>
    </div>
  </section>;
}
