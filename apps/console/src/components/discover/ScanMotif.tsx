/** Camera optics, drawn as a decorative diagram rather than a device claim. */
export function ScanMotif(){
  return <svg className="discover-scan-motif" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
    <circle cx="160" cy="160" r="142" fill="none" stroke="currentColor" strokeOpacity=".12"/>
    <g className="discover-scan-orbit"><circle cx="160" cy="160" r="123" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 13"/><path d="M160 18a142 142 0 0 1 142 142" fill="none" stroke="currentColor" strokeWidth="5"/><circle cx="302" cy="160" r="7" fill="currentColor"/></g>
    <circle cx="160" cy="160" r="91" fill="currentColor" fillOpacity=".06"/>
    <path d="M123 112h-17v17m91-17h17v17m-91 79h-17v-17m91 17h17v-17" fill="none" stroke="currentColor" strokeWidth="3"/>
    <circle cx="160" cy="160" r="31" fill="none" stroke="currentColor" strokeWidth="3"/>
    <circle cx="160" cy="160" r="9" fill="currentColor"/>
  </svg>;
}
