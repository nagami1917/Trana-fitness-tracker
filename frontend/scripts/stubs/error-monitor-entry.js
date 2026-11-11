/** Bundle entry for the error-monitor smoke test (see error-monitor-smoke.mjs). */
import { installErrorMonitor, reportClientError } from '../../src/lib/errorMonitor.js';

const requests = [];
const handlers = installErrorMonitor({
  post: (payload) => {
    requests.push(payload);
  },
  maxPerSession: 8,
});

window.__requests = requests;
window.__fireError = (message, stack) => handlers.handleError({ message, error: { message, stack } });
window.__fireRejection = (reason) => handlers.handleRejection({ reason });
window.__report5xx = (message, stack) => reportClientError({ message, stack });
