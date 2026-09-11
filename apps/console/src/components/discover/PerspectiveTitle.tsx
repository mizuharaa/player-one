/** Real, readable text; scrolling changes emphasis, never the words or layout. */
export function PerspectiveTitle({text}:{text:string}) {
  const split=text.match(/^(.*?[.，])\s*(.+)$/u);
  return <>{split?<><span>{split[1]}</span><em className="discover-perspective-keyword">{split[2]}</em></>:text}</>;
}
