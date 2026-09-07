/**
 * Standalone dev entry (index.html — `yarn dev` / local preview only).
 * The production HA panel is mounted by panel-wrapper.ts instead, straight
 * into a Shadow DOM. See app-mount.tsx for the shared mounting logic.
 */
import { mountCircuitryApp } from './app-mount';
import { logger } from './lib/logger';

const rootElement = document.getElementById('root');
if (!rootElement) {
  logger.error('No #root element found');
} else {
  logger.info('Circuitry starting in standalone mode');
  mountCircuitryApp(rootElement, { forceMode: 'remote' });
}
