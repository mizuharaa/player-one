import {useTranslation} from 'react-i18next';

/** Temporary destination. Replace with the store redirect when downloads launch. */
export const APP_QR_DESTINATION='https://playerone-web-production.up.railway.app/discover';
const copy={
  en:{title:'Get the PlayerOne app',before:'Scan the QR code below or open',after:'on your phone.',note:'For now, this code opens the PlayerOne website.',open:'Open PlayerOne on mobile'},
  vi:{title:'Tải ứng dụng PlayerOne',before:'Quét mã QR bên dưới hoặc mở',after:'trên điện thoại.',note:'Hiện tại, mã này mở trang web PlayerOne.',open:'Mở PlayerOne trên điện thoại'},
  zh:{title:'获取 PlayerOne 应用',before:'扫描下方二维码，或在手机上打开',after:'。',note:'目前，此二维码会打开 PlayerOne 网站。',open:'在手机上打开 PlayerOne'},
};

export function DownloadApp(){
  const {i18n}=useTranslation();const c=copy[i18n.language.startsWith('vi')?'vi':i18n.language.startsWith('zh')?'zh':'en'];
  return <section className="discover-download" id="download" aria-labelledby="download-title">
    <div className="discover-download-layout">
      <span className="discover-download-sticker discover-download-sticker--app" aria-hidden="true"><StoreSticker/></span>
      <span className="discover-download-sticker discover-download-sticker--play" aria-hidden="true"><PlaySticker/></span>
      <h2 id="download-title">{c.title}</h2>
      <p className="discover-download-description">{c.before} <a href={APP_QR_DESTINATION}>PlayerOne ↗</a> {c.after}</p>
      <a className="discover-download-qr" href={APP_QR_DESTINATION} aria-label={c.open}><img src="/discover-media/playerone-mobile-qr.svg" width="300" height="300" alt={c.open} loading="lazy"/></a>
      <p className="discover-download-note">{c.note}</p>
      <span className="discover-download-sticker discover-download-sticker--ticket" aria-hidden="true"><TicketSticker/></span>
      <span className="discover-download-sticker discover-download-sticker--phone" aria-hidden="true"><PhoneSticker/></span>
    </div>
  </section>;
}

// Small vector stickers reproduce the reference's positions and visual weight.
// Decorative store symbols are deliberately not download links.
function StoreSticker(){return <svg viewBox="0 0 80 80" fill="none"><g strokeLinecap="round" strokeLinejoin="round"><path d="m33 12 31 53M44 12 16 65M9 51h60" stroke="var(--download-white)" strokeWidth="17"/><path d="m33 12 31 53M44 12 16 65M9 51h60" stroke="var(--download-blue)" strokeWidth="9"/></g></svg>;}
function PlaySticker(){return <svg viewBox="0 0 80 80"><path d="M16 7q-5-3-5 5v57q0 8 7 4l54-29q7-4 0-8Z" fill="var(--download-white)" stroke="var(--download-white)" strokeWidth="10" strokeLinejoin="round"/><path d="m16 12 29 28-29 28Z" fill="var(--download-blue)"/><path d="m20 9 33 19-11 10Z" fill="var(--download-green)"/><path d="m45 41 12-10 15 9-15 9Z" fill="var(--download-yellow)"/><path d="m20 71 33-19-11-10Z" fill="var(--download-red)"/></svg>;}
function TicketSticker(){return <svg viewBox="0 0 92 68"><path d="M12 9h68q7 0 7 8v8q-12 9 0 18v8q0 8-7 8H12q-7 0-7-8v-8q12-9 0-18v-8q0-8 7-8Z" fill="var(--download-orange)" stroke="var(--download-white)" strokeWidth="7"/><path d="M12 12h19v44H12q-4 0-4-5v-7q12-10 0-19v-8q0-5 4-5Z" fill="var(--download-pink)"/><path d="M32 12v44" stroke="var(--download-white)" strokeWidth="3"/><path d="m58 24 4 7 8 1-6 6 1 8-7-4-7 4 1-8-6-6 8-1Z" fill="var(--download-white)"/></svg>;}
function PhoneSticker(){return <svg viewBox="0 0 72 96"><rect x="10" y="4" width="52" height="88" rx="15" fill="var(--download-white)"/><rect x="15" y="9" width="42" height="78" rx="11" fill="var(--download-white)" stroke="var(--download-ink)" strokeWidth="3.5"/><rect x="29" y="15" width="15" height="4" rx="2" fill="var(--download-ink)"/>{['pink','yellow','green','purple','cyan','orange'].map((color,i)=><rect key={color} x={23+i%2*16} y={30+Math.floor(i/2)*17} width="11" height="12" rx="3" fill={`var(--download-${color})`}/>)}</svg>;}
