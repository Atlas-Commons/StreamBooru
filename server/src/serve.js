// Process entrypoint. index.js stays a plain module so the tests can mount the app
// without binding a port, and so nothing hands its `app` export to a runtime that
// tries to guess what the entrypoint meant by it — Bun 1.3 passes an entrypoint's
// `app` export straight to Bun.serve(), which then rejects it for having no fetch.
require('./index').startServer();
