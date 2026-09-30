import { PROTOCOL_VERSION } from '@dialer/shared';

// Каркас сервера: HTTP, WebSocket і логіка дзвінків з'являться на кроках 2–3 (docs/backend.md).
console.log(`dialer server, протокол v${PROTOCOL_VERSION}`);
