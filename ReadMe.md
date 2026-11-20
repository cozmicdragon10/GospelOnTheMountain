Worship On The Mountain

## Run

    DEPLOY_SECRET=<long random string> ./run.sh

Set `PORT` to change the port (default 3000).

## Deploy from GitHub

Every push to `main` on GitHub is pulled onto the server and the web server is restarted.

1. Put the site on a public address that forwards to the server's port (for example a tunnel or router port forward). GitHub must be able to reach `https://<your-address>/api/deploy`.
2. Pick a long random secret and start the server with it set as `DEPLOY_SECRET` (see Run above).
3. In GitHub, go to the repo's Settings > Webhooks > Add webhook:
   - Payload URL: `https://<your-address>/api/deploy`
   - Content type: `application/json`
   - Secret: the same value as `DEPLOY_SECRET`
   - Events: "Just the push event"
4. Push to `main`. Progress is written to `deploy.log` in the project folder.

To deploy by hand, run `./deploy.sh`.

### Windows

On Windows the webhook runs `deploy.ps1` instead of `deploy.sh`. The live copy is `C:\websites\GospelOnTheMountian`. It is kept running by the "GospelOnTheMountain Site" scheduled task (`C:\websites\run-gospel-site.ps1`), which restarts the server after a deploy stops it. Put `DEPLOY_SECRET=...` in that folder's `.env`. To deploy by hand, run:

    powershell -ExecutionPolicy Bypass -File C:\websites\GospelOnTheMountian\deploy.ps1

Notes:
- `deploy.sh` runs `git reset --hard origin/main`, so any uncommitted edits on the server are discarded.
- The server must be able to run `git fetch` against GitHub, so the repo's credentials must be set up on the device.
- Runtime files (`server.pid`, `deploy.log`, `server.log`, `.env`) are git-ignored.
