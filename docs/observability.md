# Foundation observability

The current signals answer three operational questions: whether the process is alive (`GET /health`), whether it can accept application traffic (`GET /ready`), and which route failed or rejected input for a returned request ID.

Every response receives a server-generated `x-request-id`. Completion, validation rejection, and internal failure logs use stable event names. Logged request fields are allowlisted; bodies, chat text, authorization headers, cookies, tokens, passwords, and raw exception messages are excluded or redacted.

Stable events:

- `http_request_completed`
- `http_request_rejected`
- `http_request_failed`

Metrics and distributed tracing are deferred until database and TikTok dependency calls exist. At that point RED signals will use bounded route/status labels, and external-call spans will not record usernames or chat text.

The tests capture real Pino output and assert that representative credentials and chat phrases are absent.

Sources:

- https://fastify.dev/docs/latest/Reference/Logging/
- https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- https://fastify.dev/docs/latest/Reference/Errors/
- https://fastify.dev/docs/latest/Reference/Server/#genreqid
- https://ajv.js.org/guide/getting-started.html
