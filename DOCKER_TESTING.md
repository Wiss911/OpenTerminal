# Dependency update: DietPi / Futro checks

The Linux-amd64 images have now been built and tested locally using Docker
Desktop. Transfer the prebuilt archive to the Futro to avoid building there.
Do not replace the running production stack until the Futro smoke checks pass.

The images use `node:24.21.0-bookworm-slim` (Debian 12, glibc) and the npm
bundled with Node. Both Dockerfiles use the root workspace lockfile with
`npm ci --ignore-scripts`; the API runtime additionally uses `--omit=dev`.
No additional npm version, Python, or C++ compiler is installed in the images.

better-sqlite3 stays at 13.0.3. Its published package contains
`prebuilds/linux-x64.node`; ignoring install scripts avoids the implicit
node-gyp build. The API Dockerfile opens an in-memory SQLite database and
executes `SELECT 1` during the build, so a missing or incompatible native
binary fails the image build. This check passed in the actual Linux API image.

## Transfer the prebuilt images to the Futro (recommended)

The development machine exports both production images to the git-ignored
`out/openterminal-update-deps-linux-amd64.tar`, with a matching `.tar.sha256`
file. These contain image layers only, without the disposable containers' data.

Copy both files to the Futro using your existing file transfer method. On the
Futro, in the directory containing the two files:

```sh
uname -m
sha256sum -c openterminal-update-deps-linux-amd64.tar.sha256
docker load -i openterminal-update-deps-linux-amd64.tar
docker image inspect --format '{{.Os}}/{{.Architecture}}' openterminal-api:update-deps openterminal-web:update-deps
```

Expected: `x86_64`, a successful checksum, and `linux/amd64` for both images.
Continue with the isolated runtime smoke test below. No Node/npm installation
or Docker build is required on the Futro. A DietPi Trixie host can run these
Bookworm containers; the containers provide their own userspace libraries.

## Optional: reproduce the build and tests on Linux x86_64

These commands are for rebuilding from source. They are unnecessary when
using the exported images. Run them from the updated repository root; the
`update-deps` branch/commit must already have been transferred there.

```sh
git branch --show-current
uname -m
docker version

docker build --platform linux/amd64 --progress=plain -f server/Dockerfile -t openterminal-api:update-deps .
docker build --platform linux/amd64 --progress=plain -f web/Dockerfile -t openterminal-web:update-deps .

docker build --platform linux/amd64 --target build -f server/Dockerfile -t openterminal-api:update-deps-tests .
docker run --rm --entrypoint npm openterminal-api:update-deps-tests test --workspace server
```

Expected: branch `update-deps`, architecture `x86_64`, both images build,
the API build prints `SQLite prebuilt OK: linux x64`, and all 26 server tests
pass. Also verify that the build does not invoke node-gyp or install compiler
packages. The tests create disposable databases, without mounting production
data or supplying credentials.

## Isolated runtime smoke test

The following uses separate containers, a dedicated network, disposable
in-container data, and ports 14000/13000 bound only to the Futro's localhost.
It does not mount production data or require an `.env` file.

```sh
docker network create openterminal-update-deps-test

docker run -d --name openterminal-update-deps-api \
  --network openterminal-update-deps-test \
  -e API_HOST=0.0.0.0 -e DATA_DIR=/tmp/openterminal-test-data \
  -p 127.0.0.1:14000:4000 openterminal-api:update-deps

docker run -d --name openterminal-update-deps-web \
  --network openterminal-update-deps-test \
  -e HOSTNAME=0.0.0.0 -e API_URL=http://openterminal-update-deps-api:4000 \
  -p 127.0.0.1:13000:3000 openterminal-web:update-deps

curl --fail http://127.0.0.1:14000/api/status
curl --fail http://127.0.0.1:13000/api/status
curl --fail --output /dev/null http://127.0.0.1:13000/
curl --fail --output /dev/null 'http://127.0.0.1:13000/api/history/AAPL?range=6M'
curl --fail --output /dev/null http://127.0.0.1:13000/api/macro
```

Wait a few seconds after starting the containers before running curl.
Both status endpoints must return `"ok":true`; the UI must return HTTP 200.
The history and macro requests also depend on public providers and outbound
network access; provider failures must be distinguished from image failures.

To view the UI from your workstation without changing port exposure:

```sh
ssh -L 13000:127.0.0.1:13000 USER@FUTRO
```

Replace USER and FUTRO with your existing SSH login and host. Open
http://localhost:13000 in a browser and check:

- Candles, line/area/bar chart modes, range buttons, crosshair and indicators.
- The macro yield curve and its tooltip (Recharts 3).
- Moving/resizing widgets and reloading the page (React Grid Layout 2 legacy API).
- No missing JavaScript/CSS files or errors in the browser console.

Protected portfolio/AI requests need the existing deployment's shared-key
configuration and are not part of this credential-free smoke test. Verify
those separately in your normal deployment without changing or exposing keys.

Clean up only the disposable test resources:

```sh
docker rm -f openterminal-update-deps-web openterminal-update-deps-api
docker network rm openterminal-update-deps-test
```

## Local verification and remaining limitations

- Production build passed on attempt 5 under Node 24.21.0 using Webpack.
- All 26 existing server tests passed under the updated dependencies.
- ESLint uses the compatible 9.39.5 release; the newly introduced
  `react-hooks/set-state-in-effect` rule reports existing code as warnings.
- npm audit reports five high-severity entries in the development-only
  eslint-config-next → fast-glob → micromatch → braces chain. The current
  supported packages do not provide a compatible fix; no forced downgrade
  was applied. `npm audit --omit=dev` reports no production vulnerabilities.
- A clean `npm ci --ignore-scripts` installation passed against the final
  manifests and lockfile. Linux-specific optional binary packages are
  present in the lockfile; the clean local installation still runs on Windows.
- Skipping install scripts relies on the binaries provided by this locked
  dependency set. Re-run the image build and SQLite check after future updates.
- Both Docker production images built successfully for `linux/amd64` on
  Docker Desktop. The bundled Linux SQLite binary passed the image-build check.
- All 26 tests also passed in the Linux API build-stage container.
- Both production containers started with disposable data. API health and
  health through the web proxy returned `ok: true`; the UI, AAPL history,
  and macro endpoints returned HTTP 200. All nine JavaScript/CSS assets linked
  from the UI were also fetched successfully.
- The API runtime reports Node 24.21.0, bundled npm 11.19.0, and glibc 2.36.
  gcc, g++, make, and Python are absent. The disposable test containers and
  test network were removed after verification; the images and archive remain.
- Browser automation was unavailable due to a Codex browser-connection error.
  Chart interactions, layout persistence, the Futro runtime, and the production
  deployment remain unverified.
- `docker-compose.yml` is unchanged. Build both Dockerfiles with the
  repository root as context, as shown above.
