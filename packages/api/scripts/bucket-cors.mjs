/**
 * Let one browser origin PUT straight into the object store.
 *
 *   STORAGE_ENDPOINT=… STORAGE_BUCKET=… STORAGE_KEY=… STORAGE_SECRET=… \
 *     node packages/api/scripts/bucket-cors.mjs http://127.0.0.1:5173 [more origins…]
 *
 * Run it once per origin, per bucket. Nothing else in the platform needs this:
 * every other upload path is a server process PUTting from Node, and Node does
 * not enforce CORS. The console's **Debug delivery** page is the one client
 * that is a browser, and a browser will not send a cross-origin PUT to a signed
 * URL until the bucket says that origin may.
 *
 * WITHOUT IT, THE SYMPTOM IS NOT AN ERROR MESSAGE
 *
 * The preflight `OPTIONS` fails, the browser cancels the PUT, and `fetch`
 * rejects with `TypeError: Failed to fetch` and no status and no body — the
 * page then has a delivery whose files never arrived and a refusal it cannot
 * name. There is nothing in the server log either, because the request never
 * reached the server. That is why this is a script and a documented step
 * rather than a note in a comment.
 *
 * `--dry-run` prints the rule and calls nothing.
 */
import { PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { s3StoreFromEnv } from '../src/upload-worker.ts';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const origins = argv.filter((a) => !a.startsWith('--'));

if (origins.length === 0) {
  console.error(
    'usage: node packages/api/scripts/bucket-cors.mjs <origin> [origin…] [--dry-run]\n' +
      '  e.g. http://127.0.0.1:5173 for the console dev server,\n' +
      '       https://console.example.vn for a deployment.\n' +
      '  STORAGE_ENDPOINT / STORAGE_BUCKET / STORAGE_KEY / STORAGE_SECRET name the bucket.',
  );
  process.exit(2);
}

for (const origin of origins) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    console.error(`${origin}: not a URL`);
    process.exit(2);
  }
  /**
   * An origin is scheme, host and port and nothing else. `*` is refused
   * outright: this rule allows a PUT of arbitrary bytes at any key the caller
   * holds a signature for, and a wildcard would let any page on the internet
   * spend a leaked signature. A path or a trailing slash is refused because the
   * browser's `Origin` header never carries one, so such a rule silently
   * matches nothing — the worst kind of wrong.
   */
  if (origin === '*') {
    console.error('refusing "*": name the console origins, one rule per deployment');
    process.exit(2);
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    console.error(`${origin}: an origin is scheme://host[:port] with no path, query or credentials`);
    process.exit(2);
  }
  if (origin.endsWith('/')) {
    console.error(`${origin}: drop the trailing slash; the browser's Origin header has none`);
    process.exit(2);
  }
}

/**
 * What the SDK's presigned PUT actually sends, and nothing more.
 *
 * `PUT` is the delivery itself — one signed PUT per file below `PART_SIZE`, one
 * per part above it. `GET` and `HEAD` are what the same page needs to read an
 * object back when a delivery is being diagnosed; neither is used by the happy
 * path, and both are already what `verifyReadBack` does server-side.
 *
 * `AllowedHeaders: ['*']` is the one wildcard here and it is a wildcard over
 * REQUEST HEADERS, not over origins: `getSignedUrl` hoists `x-amz-meta-sha256`
 * into the query string rather than into a header, but `content-type` and
 * `content-length` still travel as headers and a store that does not allow
 * them fails the preflight. Enumerating them is a list to get wrong for no
 * security gain — an allowed header cannot authorise a request that is not
 * already signed.
 *
 * `ExposeHeaders: ['ETag']` so a browser can read the part's ETag. The server
 * completes the multipart from its own `ListParts`, so nothing depends on this
 * today; it costs one line and its absence is invisible until something does.
 */
const rule = {
  AllowedMethods: ['PUT', 'GET', 'HEAD'],
  AllowedOrigins: origins,
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3600,
};

console.log(JSON.stringify({ CORSRules: [rule] }, null, 2));
if (dryRun) {
  console.log('--dry-run: nothing was sent.');
  process.exit(0);
}

const store = s3StoreFromEnv();
if (store === null) {
  console.error('STORAGE_ENDPOINT is not set; there is no bucket to configure.');
  process.exit(2);
}

/**
 * The SDK client and the bucket name live on the store as private fields, which
 * is right — nothing outside it should be issuing bucket commands. This script
 * is the exception and says so rather than adding a method to `S3ObjectStore`
 * that only a script calls.
 */
const client = /** @type {any} */ (store).client;
const bucket = /** @type {any} */ (store).bucket;

await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [rule] } }));

/**
 * Read it back. A store that accepted the call and stored something else — or
 * nothing — is exactly the failure this script exists to prevent, and a PUT
 * that answers 200 proves only that it answered.
 */
const said = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
const stored = said.CORSRules ?? [];
const allowed = new Set(stored.flatMap((r) => r.AllowedOrigins ?? []));
const missing = origins.filter((o) => !allowed.has(o));
if (missing.length > 0) {
  console.error(`bucket ${bucket} did not store: ${missing.join(', ')}`);
  console.error(JSON.stringify(stored, null, 2));
  process.exit(1);
}
console.log(`bucket ${bucket} now allows PUT/GET/HEAD from: ${origins.join(', ')}`);
console.log('This replaces the bucket’s whole CORS configuration. Name every origin in one run.');
