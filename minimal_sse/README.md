# Minimal SSE

Small Server-Sent Events demo using the same response headers and event format as
`educlaw-server/src/utils/sse.ts`.

## Run

From the repository root:

```sh
source ~/.nvm/nvm.sh
source ./run_npm.sh
cd minimal_sse
npm start
```

Open `http://localhost:4310`.

The backend exposes:

- `GET /` for the static frontend.
- `GET /events` for the SSE stream.
