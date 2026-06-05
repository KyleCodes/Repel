import { AppError } from '../../../lib/error.ts';

// Base for failures in the provider-agnostic OAuth2 flow.
export class OAuth2Error extends AppError {}

// The state nonce echoed back by the provider did not match the one we sent —
// a CSRF signal. No credentials are produced.
export class OAuth2StateMismatchError extends OAuth2Error {}

// The loopback redirect never arrived within the configured window.
export class OAuth2TimeoutError extends OAuth2Error {}

// The provider redirected with an error (e.g. the user declined consent).
export class OAuth2DeniedError extends OAuth2Error {}
