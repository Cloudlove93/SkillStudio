# Minimal Express Router

Small Express Router demo using the same route shape as
`educlaw-server/src/routes/arena.ts`.

## Run

From the repository root:

```sh
source ~/.nvm/nvm.sh
source ./run_npm.sh
cd minimal_express_router
npm install
npm start
```

Open `http://localhost:4320`.

The backend exposes:

- `GET /` for the static frontend.
- `GET /api/threads?packageId=package-alpha` to list demo threads.
- `POST /api/threads` with `{ "packageId": "...", "title": "..." }` to create a thread.
- `GET /api/threads/:threadId` to read one thread.
