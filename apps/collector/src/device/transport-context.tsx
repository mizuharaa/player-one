import { createContext, useContext } from 'react';
import { UnavailableDeviceTransport, type DeviceTransport } from './transport.ts';

/**
 * No live native implementation is linked yet. Demo callers must explicitly
 * inject the mock; absence of a provider must never simulate real hardware.
 */
const TransportContext = createContext<DeviceTransport>(new UnavailableDeviceTransport());

export const TransportProvider = TransportContext.Provider;

export const useTransport = (): DeviceTransport => useContext(TransportContext);
