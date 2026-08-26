import { createContext, useContext } from 'react';
import { MockDeviceTransport, type DeviceTransport } from './transport.ts';

/**
 * ponytail: the default IS the mock — there is no real transport to inject
 * yet. The provider seam exists so the EgoLowBle TurboModule drops in without
 * touching a screen.
 */
const TransportContext = createContext<DeviceTransport>(new MockDeviceTransport());

export const TransportProvider = TransportContext.Provider;

export const useTransport = (): DeviceTransport => useContext(TransportContext);
