<!-- nondev-seam: skycot-update-count-operations -->

# SKYCOT update counter

This Worker serves only `downloads.skycot.com/mac/latest-mac.yml` from the existing
`skycot-downloads` R2 bucket. It keeps the feed body unchanged and adds an optional anonymous daily
count to the shared `skycot_counts` Analytics Engine dataset. The relay uses the same dataset and
secret. Counting fails open; Do Not Track and Global Privacy Control opt out.

## Deploy later

1. Confirm Wrangler is authenticated to the SKYCOT Cloudflare account and that `skycot-downloads`
   exists in the `skycot.com` zone. Check the exact route does not belong to another Worker.
2. The Analytics Engine dataset `skycot_counts` is created by the first datapoint write. Deploying
   this Worker and making one eligible feed request performs that first write; no separate create
   command is needed.
3. From this folder, run `../skycot-relay/node_modules/.bin/wrangler secret put DAILY_SALT_SECRET`
   and enter a long random secret. Use the same secret when setting `DAILY_SALT_SECRET` from
   `infra/skycot-relay`. Never put it in a file or command history.
4. Run `../skycot-relay/node_modules/.bin/wrangler deploy` from this folder. The Wrangler route is
   restricted to the exact feed path.
5. Before deployment, save the current public feed. After deployment, fetch it again and compare:

   ```sh
   # Before deployment
   curl -fsS https://downloads.skycot.com/mac/latest-mac.yml -o /tmp/skycot-feed-before.yml

   # After deployment
   curl -fsS https://downloads.skycot.com/mac/latest-mac.yml -o /tmp/skycot-feed-after.yml
   cmp /tmp/skycot-feed-before.yml /tmp/skycot-feed-after.yml
   curl -sSI https://downloads.skycot.com/mac/latest-mac.yml
   ```

   The comparison checks the pre-deployment feed bytes against the Worker response; the response
   must also return `200`, `text/yaml` and `Cache-Control: no-cache` for GET and HEAD.

6. Roll back by deleting only the `downloads.skycot.com/mac/latest-mac.yml` route in Cloudflare
   Workers & Pages. The underlying R2 object remains untouched.

No Wrangler command has been run as part of preparing this folder.
