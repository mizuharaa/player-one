import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Screen } from '../ui.tsx';
import { StatePanel } from '../ui/StatePanel.tsx';

export function Forum() {
  const tt = useT(), nav = useNav();
  return <Screen title={tt('forum.title')}><StatePanel title={tt('state.unavailable')} text={tt('state.unavailableBody')}
    action={tt('hall.title')} onPress={() => nav.selectTab('taskHall')} /></Screen>;
}
