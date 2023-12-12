import { CapabilityState } from './index';

// This is undocumented in the Alexa API for some reason but it is just a number
export const isHumidityValue = (
  state: CapabilityState['value'],
): state is number => typeof state === 'number';
