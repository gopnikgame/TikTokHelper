# Authentication configuration

The application enables VLine authentication only when all five variables are present. A partial
configuration fails at startup; no value is silently ignored.

```dotenv
VLINE_BRIDGE_AUTHORIZE_URL=https://vline.online/integrations/tiktok-helper/authorize
VLINE_BRIDGE_TOKEN_URL=https://vline.online/integrations/tiktok-helper/token
VLINE_BRIDGE_CLIENT_ID=tiktok-helper
VLINE_BRIDGE_REDIRECT_URI=https://tiktok.vpnline.online/auth/callback
```

`VLINE_BRIDGE_CLIENT_SECRET` is server-only. In Compose deployment, store it in the root-only
`secrets/tiktok_helper_client_secret` file; the container entrypoint exports it at runtime. It
must never be embedded in the frontend, Compose file, repository, image, or diagnostic output.
When authentication is enabled, HTTP workspace routes require the secure application session
cookie and Socket.IO authenticates the same cookie during the WebSocket handshake. Workspace
membership is checked independently for every HTTP request and every room/control command.

The current production deployment must not receive these variables until VLine Auth Bridge is
deployed and its real-session integration test has passed.
