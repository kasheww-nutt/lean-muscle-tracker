# Security

All queries bind values and scope personal records to the configured owner. Caller-supplied identity headers are ignored. Browser sessions use HMAC-SHA256, expiry, HttpOnly, Secure and SameSite=Strict. Session secrets must contain at least 32 characters. Mutations compare Origin to PUBLIC_BASE_URL, so the ALB's internal HTTP origin does not break CSRF protection. Security headers protect framing, MIME handling and referrers.

The original four-digit PIN UI is retained. Ten login/consent attempts per 15 minutes are permitted globally for the owner, stored in SQLite. This deliberately avoids trusting forged forwarded IP headers, but can temporarily lock out the owner if someone exhausts the allowance. Cognito SSO is stronger and can use MFA. The PIN route remains a fallback; a four-digit PIN is not equivalent to strong multi-user authentication.

MCP authentication applies before discovery and tool operations. Unauthorized requests return HTTP 401 with protected-resource metadata discovery. OAuth validates registered redirect URIs, S256 PKCE, resource/audience, client credentials when configured, short-lived authorization codes and token expiry. Codes and refresh tokens are consumed atomically and cannot be replayed. Only SHA-256 hashes of opaque credentials are saved. Access tokens last one hour; rotating refresh tokens last 30 days. Revoke individual tokens using `/oauth/revoke`. OAuth client setup is explicit; dynamic registration is not supported.

Cognito browser SSO uses signed, five-minute state cookies, PKCE and nonce matching. The AWS JWT verification library validates Cognito signatures, issuer, audience, token use and expiration. An exact owner sub is required. No other user in the pool gains tracker access. Logging out of the tracker clears its session, but does not globally sign out of the identity provider.

Widget tokens remain read-only, hashed, expiring, replaceable and revocable. The service worker caches public assets only. A filesystem publication scan is included but cannot detect every possible secret.

Deploy with ALB HTTPS, EC2 inbound 5173 allowed ONLY from the ALB security group, no public database port, Systems Manager access, least-privilege IAM, encrypted EBS and private environment files. Do not put ALB interactive authentication in front of MCP OAuth. Container runs as non-root with dropped capabilities and rotating logs. Keep backups private, encrypted and outside the instance for recovery from disk loss.

Remaining operational work: configure and verify AWS, identity providers, live ChatGPT connectivity, backup retention/off-instance copies, alerts, and live restart/restore behavior. This local test pass is not a production security audit.
