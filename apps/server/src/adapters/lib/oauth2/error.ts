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

// A refresh-token grant was rejected by the provider (the refresh token is
// revoked or expired). Terminal: re-authorization is required.
export class OAuth2RefreshError extends OAuth2Error {}

// A refresh was needed but the credentials carry no refresh token, so one was
// never possible. Distinct from OAuth2RefreshError — nothing expired; the
// credential never permitted a refresh. Also terminal (re-auth required).
export class OAuth2NoRefreshTokenError extends OAuth2Error {}
