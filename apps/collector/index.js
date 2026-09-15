import { createElement } from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { App } from './src/App.tsx';

function NativeApp() {
  return createElement(GestureHandlerRootView, { style: { flex: 1 } },
    createElement(SafeAreaProvider, { initialMetrics: initialWindowMetrics }, createElement(App)));
}
registerRootComponent(NativeApp);
