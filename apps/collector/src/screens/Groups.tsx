import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Screen } from '../ui.tsx';
import { StatePanel } from '../ui/StatePanel.tsx';

export function GroupChats() {
  const tt = useT(), nav = useNav();
  return <Screen title={tt('groups.title')}><StatePanel title={tt('state.unavailable')} text={tt('state.unavailableBody')}
    action={tt('hall.title')} onPress={() => nav.selectTab('taskHall')} /></Screen>;
}

export const GroupThread = GroupChats;
