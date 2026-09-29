// File: src/routes/retraining_routes.ts
// Description: The UNet Extend Training API (plan WS13), for users and admins, never guests. The forwarding itself
// lives in services/retraining_proxy.ts, so it can be tested without a session store.
import { createRetrainingRouter } from '../services/retraining_proxy';
import { isAuthAndNotGuest } from '../services/passportjs';

export default createRetrainingRouter({ guard: isAuthAndNotGuest });
