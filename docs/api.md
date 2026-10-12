# API

| Endpoint | Methods | Access |
|---|---|---|
| /api/health | GET | Public readiness; no personal records |
| /api/access | GET, POST, DELETE | PIN/session; mutation Origin checks |
| /api/dashboard | GET | Owner session |
| /api/history | GET | Owner session; date pagination/search/type filters |
| /api/widget | GET, POST, DELETE | Session or hashed read-only widget key |
| /mcp | POST | OAuth or private bearer; stateless JSON responses |
| /.well-known/oauth-protected-resource | GET | Public discovery |
| /.well-known/oauth-protected-resource/mcp | GET | Public path-specific discovery |
| /.well-known/oauth-authorization-server | GET | Public discovery |
| /oauth/authorize | GET, POST | Valid registered client; explicit PIN consent |
| /oauth/token | POST | Authorization code + PKCE or refresh token |
| /oauth/revoke | POST | Client-authenticated individual token revocation |
| /sso/login | GET | Starts configured Cognito login |
| /sso/callback | GET | Signed state, PKCE, verified owner identity |

MCP supports initialize, ping, tools/list, tools/call and notification acknowledgements. GET streaming is intentionally unsupported (405). Tool schemas are in backend/mcp/handler.ts. Meals and water support add/update/remove; weights and workouts support add; day/history tools read owner data. Unsupported methods use JSON-RPC errors. OAuth tokens are bound to the exact resource PUBLIC_BASE_URL + `/mcp`; token requests must include that resource parameter. Live client compatibility remains to be tested.

The dashboard continues to be a viewing interface. No manual entry forms or UI redesign were introduced. Nutrition estimates are supplied by the MCP client. Structured ingredients, raw/cooked notes, test flags and completed exercise sets are validated before insertion.
