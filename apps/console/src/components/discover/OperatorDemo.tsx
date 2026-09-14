import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDemoCursor,type Scene} from '../../lib/use-demo-cursor';
import {IconArrow,IconCamera,IconEpisodes,IconPass,IconReview,IconSettle,IconTick} from '../icons';
import {AssemblyLogo} from '../logo-animation/AssemblyLogo';
import '../../styles/discover-operator.css';

const assets='/discover-media/operator-demo/';
const words={
  en:{steps:['Uploaded','Review','Verdict','QR demo','Settled'],title:'Review workspace',queue:'Submission queue',collector:'Collector 024',task:'Prepare a drink',received:'Footage received',file:'Ego camera · right view',review:'Review the footage',criteria:['Task is visible','Hands stay in frame','Usable recording'],verdict:'Accepted',reason:'The activity is visible throughout the selected segment.',effective:'Reviewed effective time',time:'00:18',payment:'Demo settlement',scan:'Scan to preview',qr:'Demo QR only · no payment',confirm:'Simulate confirmation',done:'Settlement completed',receipt:'Example receipt',amount:'Illustrative amount',wallet:'Collector wallet',reference:'Reference',replay:'Replay demo',pause:'Pause demo',play:'Play demo',unavailable:'Preview unavailable',retry:'Retry video',footnote:'Real sample footage. Review, QR and payment states are illustrative; no money is transferred.',view:'Watch the workflow',balance:'Completed settlements',waiting:'Ready for review'},
  vi:{steps:['Đã tải lên','Duyệt','Kết quả','QR mẫu','Đã chi trả'],title:'Không gian duyệt',queue:'Danh sách bản ghi',collector:'Người thu thập 024',task:'Pha đồ uống',received:'Đã nhận bản ghi',file:'Camera Ego · góc phải',review:'Duyệt bản ghi',criteria:['Thấy rõ hoạt động','Tay nằm trong khung hình','Bản ghi sử dụng được'],verdict:'Chấp nhận',reason:'Hoạt động hiển thị rõ trong đoạn được chọn.',effective:'Thời gian hữu ích đã duyệt',time:'00:18',payment:'Chi trả minh họa',scan:'Quét để xem minh họa',qr:'QR mẫu · không thanh toán',confirm:'Mô phỏng xác nhận',done:'Hoàn tất chi trả',receipt:'Biên nhận mẫu',amount:'Số tiền minh họa',wallet:'Ví người thu thập',reference:'Mã tham chiếu',replay:'Xem lại',pause:'Dừng minh họa',play:'Phát minh họa',unavailable:'Không thể tải bản xem trước',retry:'Thử lại video',footnote:'Bản ghi mẫu thực tế. Các bước duyệt, QR và chi trả là minh họa; không chuyển tiền.',view:'Xem quy trình',balance:'Các khoản đã chi trả',waiting:'Sẵn sàng duyệt'},
  zh:{steps:['已上传','审核','结果','二维码演示','已结算'],title:'审核工作台',queue:'提交队列',collector:'采集员 024',task:'准备饮品',received:'已收到视频',file:'Ego 相机 · 右视角',review:'审核视频',criteria:['任务清晰可见','双手在画面内','录像可用'],verdict:'接受',reason:'所选片段中的活动清晰可见。',effective:'已审核有效时间',time:'00:18',payment:'结算演示',scan:'扫码预览',qr:'仅演示二维码 · 不付款',confirm:'模拟确认',done:'结算完成',receipt:'示例收据',amount:'示例金额',wallet:'采集员钱包',reference:'参考编号',replay:'重播演示',pause:'暂停演示',play:'播放演示',unavailable:'预览不可用',retry:'重试视频',footnote:'真实示例视频。审核、二维码及付款状态仅供演示，不转移资金。',view:'查看流程',balance:'已完成结算',waiting:'等待审核'},
};

/**
 * The scripted hand's route, one scene per demo state.
 *
 * Every `press` sits 600–800 ms after its `at`, inside the 400–900 ms the brief
 * asks for: that gap is the whole difference between a hand and a cursor that
 * teleports into a click. `duration` is a fallback — the beat's click advances
 * the step by running the control's own handler, and the scene only times out
 * if a state has no control to press (the receipt).
 *
 * The zoom is on state 1 alone, where the demo is looking at the footage.
 */
const SCENES:readonly Scene[]=[
  {beats:[{target:'open',at:700,press:1400}],duration:2800},
  {beats:[{target:'criterion-0',at:500,press:1200},{target:'criterion-1',at:1700,press:2400},{target:'criterion-2',at:2900,press:3600},{target:'next',at:4200,press:5000}],duration:5800,zoom:1.06},
  {beats:[{target:'next',at:1000,press:1700}],duration:2600,pan:26},
  {beats:[{target:'confirm',at:700,press:1500}],duration:2700},
  {beats:[],duration:3400},
];

/** Reduced motion has no hand, so the states change on this instead. */
const REDUCED_DWELL=4200;

export function OperatorDemo({motionPaused,reducedMotion}:{motionPaused:boolean;reducedMotion:boolean}){
  const {t,i18n}=useTranslation();const c=(key:string)=>t(`discoverV2.${key}`);
  const w=words[i18n.language.startsWith('vi')?'vi':i18n.language.startsWith('zh')?'zh':'en'];
  const root=useRef<HTMLElement>(null);const video=useRef<HTMLVideoElement>(null);
  const [step,setStep]=useState(0);const [paused,setPaused]=useState(false);const [visible,setVisible]=useState(false);const [hidden,setHidden]=useState(document.hidden);const [failed,setFailed]=useState(false);
  const [checked,setChecked]=useState<readonly boolean[]>([false,false,false]);
  const awake=visible&&!hidden&&!paused&&!motionPaused;
  const running=awake&&!reducedMotion;
  useEffect(()=>{const node=root.current?.querySelector('.operator-window');if(!node)return;const observer=new IntersectionObserver(([entry])=>setVisible(!!entry?.isIntersecting),{threshold:.25});observer.observe(node);const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);return()=>{observer.disconnect();document.removeEventListener('visibilitychange',visibility);};},[]);
  const advance=()=>setStep(s=>(s+1)%5);
  useDemoCursor(root,step,running,SCENES,advance);
  /* No hand: the states still have to turn over, so a timer does it and the
     cross-fade is the only motion left. */
  useEffect(()=>{if(!reducedMotion||!awake)return;const timer=window.setTimeout(advance,REDUCED_DWELL);return()=>window.clearTimeout(timer);},[reducedMotion,awake,step]);
  useEffect(()=>{const node=video.current;if(!node)return;if(awake&&(step===1||step===2))void node.play().catch(()=>{});else node.pause();},[awake,step]);
  useEffect(()=>{if(step===0)setChecked([false,false,false]);},[step]);
  const restart=()=>{setStep(0);setChecked([false,false,false]);};
  const action=step===0?w.review:step===1?w.verdict:step===2?w.payment:step===3?w.confirm:w.replay;
  const captions=[['Record',IconCamera],['Review',IconReview],['Pay',IconSettle]] as const;
  return <section ref={root} id="introduction" className="operator-hero" data-running={running}>
    <div className="operator-intro">
      <div className="operator-partners" aria-label="VNG PT Lab × PaXini"><span className="operator-vng"><img src={`${assets}vng.png`} alt="VNG"/></span><span className="operator-partner-cross" aria-hidden="true">×</span><span className="operator-paxini"><img src={`${assets}paxini.png`} alt="PaXini"/></span></div>
      <h2>{c('introTitle')}</h2><p>{c('introBody')}</p>
    </div>
    {/* The mockup: one window, its own chrome, nothing else moving on the field. */}
    <div className="operator-window" data-step={step} onPointerDown={()=>setPaused(true)}>
      <div className="operator-window-bar">
        <span className="operator-window-dots" aria-hidden="true"><i/><i/><i/></span>
        <span className="operator-url-pill"><span className="operator-url">playerone.vn/{w.title.toLowerCase().replace(/\s+/g,'-')}</span><span className="operator-url-note">{c('heroUrlNote')}</span></span>
        <button className="operator-window-toggle" onClick={()=>setPaused(p=>!p)} disabled={motionPaused} aria-label={paused?w.play:w.pause} aria-pressed={paused}><span aria-hidden="true">{paused?'▶':'❙❙'}</span></button>
      </div>
      <div className="operator-window-content">
        <div className="operator-appbar"><AssemblyLogo title="PlayerOne"/><span className="operator-avatar">PT</span></div>
        <div className="operator-workspace-body">
          <aside className="operator-rail" aria-hidden="true"><span><IconEpisodes size={17}/></span><span className={step<3?'selected':''}><IconReview size={17}/></span><span className={step>=3?'selected':''}><IconSettle size={17}/></span></aside>
          <div className="operator-desk">
            <div className="operator-desk-heading"><div><span>{step<3?w.queue:w.payment}</span><h3>{step<3?w.task:w.collector}</h3></div><span className="operator-status">{w.steps[step]}</span></div>
            <div className="operator-display">
              <div className="operator-inbox operator-screen" data-active={step===0} inert={step!==0} aria-hidden={step!==0}>
                <div className="operator-inbox-title"><span className="operator-upload-symbol"><IconEpisodes size={22}/></span><h4>{w.received}</h4><span>{w.waiting}</span></div>
                <button className="operator-file-row" data-demo-target="open" onClick={()=>setStep(1)}><img src={`${assets}review-poster.webp`} alt=""/><span><strong>{w.task}</strong><small>EGO-003357 · {w.collector}</small></span><b><IconArrow size={18}/></b></button>
                <div className="operator-file-meta"><span>{w.file}</span><span>00:18 · MP4</span></div>
                <div className="operator-transfer"><span>{w.received}</span><strong>100%</strong><i/></div>
              </div>
              <div className="operator-review-stage operator-screen" data-active={step===1||step===2} inert={step!==1&&step!==2} aria-hidden={step!==1&&step!==2}>
                <div className="operator-footage"><video ref={video} src={`${assets}review.mp4`} poster={`${assets}review-poster.webp`} muted loop playsInline controls={paused||reducedMotion||motionPaused} aria-label={w.review} preload="metadata" onError={()=>setFailed(true)}/><span className="operator-footage-label"><i/>{w.file}</span><span className="operator-time">00:12 · 00:30</span>{failed&&<div className="operator-video-error"><p>{w.unavailable}</p><button onClick={()=>{setFailed(false);video.current?.load();}}>{w.retry}</button></div>}</div>
                <div className="operator-review-panel" data-verdict={step===2}>
                  <div className="operator-review-checklist"><strong>{w.review}</strong><div className="operator-criteria">{w.criteria.map((label,index)=><button type="button" key={label} data-demo-target={`criterion-${index}`} aria-pressed={checked[index]} onClick={()=>setChecked(list=>list.map((value,i)=>i===index?true:value))}><IconTick size={14}/>{label}</button>)}</div></div>
                  <div className="operator-verdict-panel"><div className="operator-verdict"><span className="operator-check"><IconPass size={17}/></span><strong>{w.verdict}</strong><span>{w.effective} <b>{w.time}</b></span></div><p>{w.reason}</p></div>
                </div>
              </div>
              <div className="operator-payment operator-screen" data-active={step===3} inert={step!==3} aria-hidden={step!==3}>
                <div className="operator-payment-brand"><img className="operator-zalo" src={`${assets}zalopay.png`} alt="ZaloPay"/><span>{w.payment}</span></div>
                <h4>{w.scan}</h4><div className="operator-qr"><img src={`${assets}demo-qr.svg`} alt={w.qr}/><i aria-hidden="true"/></div><p>{w.qr}</p><button data-demo-target="confirm" onClick={()=>setStep(4)}>{w.confirm}<span aria-hidden="true">→</span></button>
              </div>
              <div className="operator-payment operator-receipt operator-screen" data-active={step===4} inert={step!==4} aria-hidden={step!==4}>
                <div className="operator-payment-brand"><img className="operator-zalo" src={`${assets}zalopay.png`} alt="ZaloPay"/><span>{w.receipt}</span></div>
                <span className="operator-settled-check"><IconTick size={19}/></span><h4>{w.done}</h4><strong className="operator-amount">+ 12.000 ₫</strong><small>{w.amount}</small><dl><div><dt>{w.wallet}</dt><dd>{w.collector}</dd></div><div><dt>{w.reference}</dt><dd>DEMO-0024</dd></div><div><dt>ZaloPay</dt><dd className="operator-paid">{w.steps[4]}<IconTick size={13}/></dd></div></dl>
              </div>
            </div>
            <footer><span>EGO-003357 · {step===4?w.balance:w.collector}</span><button data-demo-target="next" onClick={()=>{if(step===4)restart();else setStep(step+1);}}>{action}<span aria-hidden="true">{step===4?'↺':'→'}</span></button></footer>
          </div>
        </div>
        <div className="operator-cursor" aria-hidden="true"><svg viewBox="0 0 22 30" width="22" height="30"><path d="M2.5 1.5 2.5 24.6 7.9 19.3 11.6 27.9 15.1 26.3 11.5 17.8 18.6 17.8Z" fill="#0b0d10" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
      </div>
    </div>
    <nav className="operator-step-nav" aria-label={w.title}>{w.steps.map((label,index)=><button key={label} onClick={()=>{setPaused(true);setStep(index);}} aria-current={step===index?'step':undefined}><span>{String(index+1).padStart(2,'0')}</span>{label}</button>)}</nav>
    {/* Daylight's caption row: three short lines, the console's own icons. */}
    <ul className="operator-captions">{captions.map(([key,Icon])=><li key={key}><Icon size={19}/><strong>{c(`heroCaption${key}Title`)}</strong><p>{c(`heroCaption${key}Body`)}</p></li>)}</ul>
    <p className="operator-disclosure">{w.footnote}</p>
  </section>;
}
