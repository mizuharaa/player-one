import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRegistry } from 'react-native';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/be-vietnam-pro/800.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-800.css';
import { Harness } from './Harness.tsx';

/**
 * The screens, in a browser, so they can be looked at and screenshotted.
 *
 * This is **not a shipping target**. The collector app is Android
 * (PRODUCT.md, decision C10) and react-native-web is here to answer one
 * question a typecheck cannot: what does the screen actually look like. It
 * runs against `MockCollectorApi` — `USE_MOCK_API` is forced by the Vite
 * config — so nothing here touches the platform.
 *
 * What it cannot tell you, and must not be quoted for: elevation and Android
 * shadows (react-native-web drops them), the real system font metrics,
 * `StatusBar.currentHeight`, the gesture-bar inset, and TalkBack. Every one of
 * those needs a device.
 *
 * Be Vietnam Pro is loaded here because the browser can load it and the phone
 * cannot yet — `ui.tsx`'s `face()` names it first and the platform face
 * second, so this harness shows the typography the design asks for while the
 * app keeps rendering in the system face until the asset is linked.
 */
AppRegistry.registerComponent('PlayerOneCollector', () => Harness);

const root = document.getElementById('root');
if (root === null) throw new Error('no #root');
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
