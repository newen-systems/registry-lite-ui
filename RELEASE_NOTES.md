registry-lite-ui is a web UI for a plain `registry:2` that browses, copies, moves, promotes and deletes images through the registry's own HTTP API, and optionally browses one GitLab group's PyPI packages.

## Run it

`podman-compose up -d` with `compose.yml` (registry and UI), or `podman-compose -f compose.ui.yml up -d` with `REGISTRY_URL` set for a registry that already runs. `docker compose` works the same way. Pin `UI_IMAGE` to a version or a digest in your `.env`.

## Changes in 0.3.16

### New Features

- A bulk delete is no longer capped at 100 tags. The Tags view and a repository's Storage tab send the selection in calls of at most 100 (the server's cap), indexes first and every tag of one digest in the same call, and show the progress ("call 1 of 2")
- The Storage view keeps your Map or Table choice across a page reload, in the browser's saved preferences, for the Storage view and a folder's Storage tab alike
- In the Storage table, a row's name is the one way into it: a folder name opens that folder in the view you are using, a repository name opens its Storage tab, where its tags are picked. The "Show in map" and "Select tags" links are gone: "Select tags" went to the same page as the repository name, and "Show in map" opened the folder but stayed on the table
- Deleting every tag in a repository at once (Select all, or a quick select that picks them all) asks you to type the repository name before Delete is enabled

### Bug Fixes

- Move to bin (or Delete) from a repository's Storage tab now shows the results dialog and updates the Bin count, as the Tags view does. It used to fail after the delete went through, on the Tags view's selection, which that tab never opens, so it showed nothing and left the selection and the Bin count stale
- A delete, copy or move shows what it is doing (for example "Moving 3 tags to the Bin...") until it finishes or fails, instead of nothing. The banner is now a live region, so screen readers announce it

## Changes in 0.3.15

### New Features

- The UID the UI runs as is now set with `PUID`/`PGID` alone, linuxserver-style, with no `user:` override, no init container and no chown step. The image starts as root and `server.py` drops to `PUID`:`PGID` at the very start, before it reads any key or secret or binds. `PUID`/`PGID` default to 65534 and win over `UID`/`GID`. `PUID=0 PGID=0` stays root (one info line, no drop), which reads a registry storage directory owned `root:root` mode 750 that a non-root UID cannot. The UI never chowns an existing path and never touches the registry storage; it only creates `UI_STATE_DIR` if missing, owned by the run UID, and falls back to in-memory history with a clear log line when that directory exists but is not writable. Setting `user: "UID:GID"` in compose still works: the UI runs as that UID and logs if `PUID` differs. The bundled compose files keep the Recent history on a volume by pointing `UI_STATE_DIR` at a sub-path the UI creates, so no host-side chown is needed

### Notes

- This replaces the 0.3.14 approach, which needed `user: "0:0"` and chowned `UI_STATE_DIR`. The image's default `USER` is now `0` (it drops at runtime) rather than `65534`, and `/state` is no longer baked into the image. If you set `UI_STATE_DIR` to a path on a volume that your chosen UID cannot write, history is kept in memory only until you make it writable or set `PUID=0 PGID=0`

## Changes in 0.3.14

### New Features

- The UI can run as any uid and gid, to match a registry that does not run as the image's 65534. Start the container as root (`user: "0:0"`) and set `PUID`/`PGID` (or `UID`/`GID`, with `PUID`/`PGID` winning): at the very start, before it reads any key or secret or binds, the UI chowns `UI_STATE_DIR` to that id and drops to it for good, then verifies it can no longer regain uid 0. The image is distroless with no shell, so this is done in Python, not an entrypoint. Running as root with no `PUID` keeps the old behaviour but logs a warning; a non-root start with a `PUID` that already matches is fine, and one that does not is logged with how to switch (start as root). Setting `user: "UID:GID"` in compose still works too, with `/state` mounted so that uid can write it. The README env table and the compose files carry the example. Non-integer ids fail at start with a clear message

## Changes in 0.3.13

### New Features

- When a directory under `UI_REGISTRY_STORAGE_MOUNT` cannot be read because of a permission error, the `storage probe:` log at start now adds an `errno 13 (Permission denied)` line that names the UID the UI runs as and the `chown` that fixes it, instead of a bare `NOT READABLE`. The README explains the same `Permission denied` on the registry's own `/var/lib/registry`: the registry runs as uid 65534, so its storage must be owned by or readable to that uid, which `registry-init` does for the named volume but not for a host bind mount
- The README and the compose files now explain sharing the registry's storage between the registry and the UI on an SELinux host (RHEL, Fedora). A host bind mount tagged `:Z` (private) lets only the registry read it and gives the UI `errno 13`; both services must mount the storage `:z` (shared), the UI read-only (`:ro,z`). `compose.yml` and `compose.ui.yml` carry the shared-mount example, and the troubleshooting section covers the fapolicyd case where the daemon blocks the reader the registry's policy allows

## Changes in 0.3.12

### Bug Fixes

- Copy and Move no longer let a copy or move through onto an existing destination tag with no warning. When the destination repository exists but its tag list has not loaded yet, the dialog showed nothing and kept the button enabled, so a fast click could overwrite a tag silently. It now shows "Checking the destination..." and keeps the button disabled until the tags load, then warns if the tag is taken

## Changes in 0.3.11

### New Features

- A folder in the tree now has a Storage tab, the same disk map and table as the Storage view scoped to that folder, so browsing a folder shows what it holds and lets you drill into its repositories without leaving the tree. Shared-layer detail and the growth history stay on the full Storage view, linked from the tab

### Bug Fixes

- The checkboxes in a repository's Storage tab now match the app theme and accept shift-click to select or clear a range of tags, the same as the Tags tab
- The Bin heading showed a plain square where its icon should be. It now has a bin icon

## Changes in 0.3.10

### New Features

- At start, with `UI_REGISTRY_STORAGE_MOUNT` set, the log has `storage probe:` lines: whether the mount, the storage root, `blobs/` and `repositories/` can be read, and whether one tag link can be. A mount one level too deep says which directory to mount instead. Each storage scan logs a `usage scan:` summary line
- `LOG_LEVEL=debug` logs each registry walk, the push time each tag found by the first walk got and where from, each tag history that cannot be read with the error, and each manifest read over the API because the storage copy could not be read

### Bug Fixes

- A tag already in the registry when the UI first walks it no longer shows the walk's time as its push time. It shows its tag link's file time from the storage mount, or nothing when that cannot be read. The Storage tab of a repository no longer falls back to the walk's time either. A state file from an earlier release drops the push time of every tag whose push time equals its first-seen time, so a tag first pushed while the UI ran shows blank until it is pushed again

## Changes in 0.3.9

### New Features

- The sizes in the tree follow Size by on the Storage map: the total a folder or repository uses, or the unique bytes only it holds. Switching changes the tree at once, and the tooltip names the measure ([#59](https://github.com/newen-systems/registry-lite-ui/pull/59))

### Bug Fixes

- The line above the Storage map is again the folder's own total or unique figure, as in 0.3.7, not the sum of the blocks, which counts a shared layer once in each block. It equals the tree figure for the same folder ([#59](https://github.com/newen-systems/registry-lite-ui/pull/59))

### Chores

- The Up button is removed. The breadcrumb links go up a level, and every drill-down and crumb still adds a history entry so Back steps one level ([#59](https://github.com/newen-systems/registry-lite-ui/pull/59))

## Changes in 0.3.8

### Bug Fixes

- The line above the Storage map is the sum of the blocks drawn, under both Total and Frees. Under Total it said the union of the folder's bytes, which is less than the blocks add up to ([#58](https://github.com/newen-systems/registry-lite-ui/pull/58))

## Changes in 0.3.7

### Bug Fixes

- The line above the Storage map follows the Size by choice: Total shows the bytes the folder uses, shared layers included, and Frees the unique bytes. The tree sizes setting says they are unique sizes, and the tree figure names the measure in its tooltip ([#57](https://github.com/newen-systems/registry-lite-ui/pull/57))

## Changes in 0.3.6

### New Features

- The Storage map sizes blocks by Total by default (every byte a block uses, shared layers included), so a repository whose layers are all shared still has a block. A "Size by" Total or Frees control, remembered per viewer, switches to the unique bytes that deleting a block frees ([#56](https://github.com/newen-systems/registry-lite-ui/pull/56))
- An Up button at the start of every breadcrumb goes to the parent level. Every drill-down, crumb and Up adds a browser history entry, so Back, Alt+Left and Cmd+[ step back one level ([#56](https://github.com/newen-systems/registry-lite-ui/pull/56))

### Bug Fixes

- "1 item here hold no bytes" now reads "holds" ([#56](https://github.com/newen-systems/registry-lite-ui/pull/56))

## Changes in 0.3.5

### New Features

- The Storage view follows every path segment: folder, folder, repository, tag, so `org/team-a/backend/api` sits under `org`, `team-a` and `backend`. The map shows one folder level at a time (click a folder to open it, crumbs show the segment names) with blocks for subfolders, repositories and tags. Items under 2% of the view are grouped into one "N smaller items" block. The table expands at every level. A path can be a repository and a folder at once ([#55](https://github.com/newen-systems/registry-lite-ui/pull/55))
- A layer used by more than one item is counted once in a block that says what shares it ("Layers used by more than one top-level folder", "...in org/team-a") at the lowest folder that holds them all. Clicking it, or expanding it in the table, lists the folders or repositories that use it and the bytes each uses ([#55](https://github.com/newen-systems/registry-lite-ui/pull/55))
- Helm charts and other OCI artifacts are counted like images and show their own icon in the table. Tags whose manifests could not be read are listed in a note instead of being left out silently, and a line says Python packages live in GitLab and are not counted ([#55](https://github.com/newen-systems/registry-lite-ui/pull/55))

### Bug Fixes

- A push or delete now triggers a new storage scan within a minute, so a chart or image pushed after the last hourly scan shows in Storage and in the totals. The growth history still gets one point per scan interval ([#55](https://github.com/newen-systems/registry-lite-ui/pull/55))

## Changes in 0.3.4

### Chores

- The Storage row and the disk pill use a hard drive icon in place of the round one that read as a chart ([#54](https://github.com/newen-systems/registry-lite-ui/pull/54))

## Changes in 0.3.3

### New Features

- Settings, Show sizes in the tree (off by default, kept per viewer): the unique size of each folder and repository with a thin solid bar under the name, hidden when it would be a dot. With it off the tree looks as before 0.3.0 and the Storage row keeps its percentage ([#53](https://github.com/newen-systems/registry-lite-ui/pull/53))

### Bug Fixes

- Recent keeps at least the newest 100 events whatever their age, so a registry whose images are all older than `UI_MAX_EVENT_DAYS` no longer shows an empty Recent after a restart. Age pruning applies beyond that floor ([#53](https://github.com/newen-systems/registry-lite-ui/pull/53))
- The Storage tab quick select no longer selects every tag when its placeholder is shown: the placeholder cannot be picked, a choice resets the menu so it can be made again, and only a positive number of days selects by age ([#53](https://github.com/newen-systems/registry-lite-ui/pull/53))

### Chores

- One way into Storage: the header button is gone, the tree row and the disk pill (now a link) remain. The Map and Table toggle uses the shared segmented control, the selection bar and tab bar reuse existing styles, and the Storage colours are tokens with dark-theme values ([#53](https://github.com/newen-systems/registry-lite-ui/pull/53))

## Changes in 0.3.2

### Bug Fixes

- The size beside a folder or repository in the tree is its unique size, and the repository Storage tab says which figure is the total with shared layers and which is the unique size the tree shows, so the two no longer look like a disagreement ([#52](https://github.com/newen-systems/registry-lite-ui/pull/52))

## Changes in 0.3.1

### Bug Fixes

- The Recent intro says which times are seen live and which come from storage or the image, and the Storage tab on a repository uses the same tab style as the rest of the app ([#51](https://github.com/newen-systems/registry-lite-ui/pull/51))

## Changes in 0.3.0

### New Features

- Storage view (header, Storage, or the Storage row under Recent): a disk map of the registry by size, to see what to delete. A block per repository in a column per namespace, area is the bytes only that repository holds (a layer several repositories use counts once, at the lowest level that holds all of them), coloured by how long ago its oldest tag was last used. A Table toggle lists folder, repository and tag with unique size, shared size, tag count and oldest and newest last used, sortable at each level, with Delete on a tag and Select tags on a repository. Four cards show the largest repository, what has not been used in 180 days and what deleting it frees, layers no tag uses (garbage collection frees them now) and growth over 30 days ([#50](https://github.com/newen-systems/registry-lite-ui/pull/50))
- Disk fill: a pill in the header and a percentage on the Storage row show how full the filesystem under `UI_REGISTRY_STORAGE_MOUNT` is, and the tree shows the size of each folder and repository with a thin bar coloured by age ([#50](https://github.com/newen-systems/registry-lite-ui/pull/50))
- Storage tab beside Tags on every repository: tags sorted by last use with what deleting each frees, a quick select ("Not pulled in 180 days", "All but the newest 10"), and a selection bar that says how much garbage collection frees and hands the selection to Delete selected, which moves the tags to the Bin ([#50](https://github.com/newen-systems/registry-lite-ui/pull/50))
- A tag's last-used age is the newest of the layers only that image holds, so a base layer another image pulls does not make it look used. When no layer has an access time newer than its write time (`noatime`, or an NFS server that does not update it) the age is labelled as a push time ([#50](https://github.com/newen-systems/registry-lite-ui/pull/50))

### Chores

- The Usage page and its chart are replaced by the Storage view, which keeps a small growth line. `#/usage` opens Storage ([#50](https://github.com/newen-systems/registry-lite-ui/pull/50))

## Changes in 0.2.31

### Bug Fixes

- Recent lists container images again after a start. Tags found by the first walk of the registry were dropped, so with no saved history (no `/state` volume, or one that is not writable) Recent showed only PyPI uploads. Each is now an event with a real time: the tag's file time in the registry storage when `UI_REGISTRY_STORAGE_MOUNT` is set, else the image's build time from its config, else it is left out. Such events say "storage time" or "build time", and a start that loads a saved history adds none ([#49](https://github.com/newen-systems/registry-lite-ui/pull/49))
- A banner says container history is in memory only when the state directory is not set or not writable ([#49](https://github.com/newen-systems/registry-lite-ui/pull/49))

## Changes in 0.2.30

### New Features

- Recycle bin: Delete, Delete selected and the source of a Move keep each removed tag, its digest, media type, size and manifest bytes in the state file, and the Bin page (header) lists them with Restore, Delete forever and Empty bin. Restore pushes the same manifest back to its tag after checking every layer with a HEAD, and fails with a clear message if garbage collection already removed one, or if the tag now points at another digest. `UI_BIN_DAYS` sets the retention (default 7), `0` deletes at once as before, and `UI_READONLY` and a missing login refuse the bin actions ([#48](https://github.com/newen-systems/registry-lite-ui/pull/48))

## Changes in 0.2.29

### New Features

- Last used: with `UI_REGISTRY_STORAGE_MOUNT`, the tag list, the tag page and the Layers table show when a blob was last used, from the layer file's access time where it is newer than its modification time, else the modification time, else the creation time, with the source shown beside it. The columns sort ([#47](https://github.com/newen-systems/registry-lite-ui/pull/47))
- Usage page (header, Usage): a chart of the total, the on-disk total and the five largest repositories over time, kept in the state file for 90 days (hourly for a week, then daily). `UI_USAGE_INTERVAL` sets the scan interval, `0` turns it off ([#47](https://github.com/newen-systems/registry-lite-ui/pull/47))
- Usage map on the same page: a treemap of unique space by namespace, repository and tag, coloured by last use so stale data stands out, with a click to drill down ([#47](https://github.com/newen-systems/registry-lite-ui/pull/47))

## Changes in 0.2.28

### Chores

- Base image moved from UBI 9 Python 3.12 to Chainguard Python (Wolfi, Python 3.15). The compressed image goes from 181 to 26 MiB, and Grype from 13 high, 169 medium and 95 low to 1 low. The UI still runs as uid 65534 with the same HEALTHCHECK ([#45](https://github.com/newen-systems/registry-lite-ui/pull/45))
- The image has no shell, `id` or `printenv`: run checks inside the container with `python -c` ([#45](https://github.com/newen-systems/registry-lite-ui/pull/45))

## Changes in 0.2.27

### Chores

- Each GitHub release shows only its own section of these notes, grouped by type, with a link to the full history, and a build fails when `VERSION` has no section here ([#44](https://github.com/newen-systems/registry-lite-ui/pull/44))

## Changes in 0.2.26

### Bug Fixes

- Build tags no longer read as versions: platform images are pushed by digest with no tag and each build is tagged `sha-<first 7 hex>`, so Renovate with `loose` versioning stops offering tags such as `94e9ce83...-arm64` as version 94. Older build tags stay because earlier releases use them ([d0abc7e](https://github.com/newen-systems/registry-lite-ui/commit/d0abc7e))

## Changes in 0.2.25

### Chores

- Base image bumped to the current UBI 9.8 Python 3.12 minimal build, which fixes CVE-2026-114406 (critical, ca-certificates), CVE-2026-77214 and CVE-2026-102633 (expat), CVE-2026-34743 (xz-libs) and CVE-2026-8932 (curl) ([3128557](https://github.com/newen-systems/registry-lite-ui/commit/3128557))
- pip removed from the image, since the app uses the standard library only. This clears six pip 24.2 advisories, and Grype now reports no fixable vulnerability on linux/amd64 or linux/arm64 ([3128557](https://github.com/newen-systems/registry-lite-ui/commit/3128557))

## Changes in 0.2.24

- The GitLab CI build publishes the same tags as ghcr.io: a release tag `vX.Y.Z` publishes `X.Y.Z`, `X.Y`, `X` and `latest`, and main moves `edge`. Before, main moved `latest` and a release was published only as `vX.Y.Z`, so Renovate on a GitLab copy saw no `X.Y.Z` releases and raised digest updates of `latest`. A deployment that follows `latest` from a GitLab copy now gets releases only: use `edge` to follow main.
- A GitLab release tag that does not match `VERSION` fails the pipeline before the build.
- `BUILD_PLATFORM` sets the platform of the GitLab build, which otherwise is the runner's own architecture.

## Changes in 0.2.23

- The tag page names its digest: an index digest (what a pull by tag and Renovate use), a manifest digest (one platform, no index) or a platform digest. The Platforms table lists each platform digest with a copy button.
- Tag history: every digest a tag has pointed at, when it took it, and whether it is current, pullable by digest or deleted. Read from the registry storage mounted read-only, set with the new `UI_REGISTRY_STORAGE_MOUNT`. `compose.yml` mounts it.
- The Layers table has an order column and, with the storage mounted, when each layer was pushed. Every column sorts.
- Tags on one digest are marked wherever they sit in the tag list, not only when they are next to each other. Hovering one highlights the others.
- Copy to and Move to: clicking a folder in the picker opens it and keeps its place. Before, focus jumped back to the previous row and the list scrolled away, and the picked folder was not highlighted.
- README: pin deploys by digest.

## Changes in 0.2.22

- A repository has its own stacked icon in the tree, the destination picker, folder lists and its page. The folder icon now means a path that is only a parent, such as `team` in `team/app`.
- Picking a folder in Copy to and Move to puts the source name inside it (`web` gives `web/alpine`). Typing a folder's bare name still works, with a warning that it makes a repository of that name beside what the folder holds.
- README: `library/` is an ordinary name on a private registry. Only Docker Hub maps `alpine` to `library/alpine`.

## Changes in 0.2.21

- Copy to and Move to put the destination repository and tag on one row, joined by a colon as in the result, with their status on one line below. The folder picker moved under them.

## Changes in 0.2.20

- README: Usage explains that features are separate compose files added with `-f`, shows the common mixes and `config` to see the merged result, and gives a systemd unit for podman-compose. A new Keycloak section covers the client, the `groups` client scope that `OIDC_ALLOWED_GROUPS` needs, and federated users.

## Changes in 0.2.19

- The type filter stays open while you change the choice. A click outside or Escape closes it.
- Settings comes before Help in the header.
- A code block's Copy button turns green while it says Copied, like the copy icons elsewhere.

## Changes in 0.2.18

- The type filter's funnel is solid blue while it filters and a grey outline on All types, so a filtered tree is easier to spot.

## Changes in 0.2.17

- The type filter moves from its own row under Filter to a funnel button beside it, which opens the choices (All types, Containers, Helm charts, Python packages) with the same icons as the tree. The funnel turns blue while it filters. Escape or a click outside closes it.
- Log in and Log out are buttons with the same size and style as Help and Settings.
- The line that joins tags on one digest runs unbroken through the row borders.
- The type filter always offers Containers, which now leaves out the repositories that hold Helm charts. Before, it appeared only with PyPI configured and still listed the charts. Python is now "Python packages".

## Changes in 0.2.16

- The countdown pie empties clockwise, like a clock, instead of anticlockwise.

## Changes in 0.2.15

- Settings, Live updates, Notify on push: a desktop notification for the pushes the page sees while its window is not in focus, so you can push, switch away and hear when the image lands. One push names the tag and opens it on click. Several in one refresh are one notification that opens Recent. The browser asks for permission when the switch is turned on, and offers notifications on HTTPS and localhost only. Deletes do not notify.

## Changes in 0.2.14

- The countdown to the next refresh is a small pie beside "live, checked" instead of a line under the header. The accent slice shrinks to nothing as the next walk of the registry comes.

## Changes in 0.2.13

- The sidebar type filter is a Show list (All, Containers, Helm charts, Python) instead of a row of buttons. Four buttons did not fit a sidebar narrower than about 240 pixels.

## Changes in 0.2.12

- In a tag list, neighbouring rows on one manifest digest (`latest` and `1.2.3`, say) are joined by a line with a circle per row in the Digest column. Its tooltip names every tag on that digest. Sort by Digest to bring them all together.
- Fixed: "Copied" beside a row's copy icon pushed every column to its right along. It now shows above the icon.

## Changes in 0.2.11

- Recent for the registry survives a restart of the container however it is run. The image now sets `UI_STATE_DIR=/state`, so a plain `docker run` or a deployment without the variable writes `state.json` too. The compose files already did this with the `ui-state` volume. `UI_STATE_DIR=` (empty) keeps history in memory only, as before.
- A state directory the UI cannot write (a read-only root without a volume at `/state`) gives one warning at start and keeps history in memory, instead of a warning at every save.

## Changes in 0.2.10

- A Helm chart's Pull tab also has a copyable install command: `helm install <chart> oci://<host>/<repo> --version <version>`. The release takes the chart's name, with any character a release name does not allow turned into `-` and cut to 53 characters.

## Changes in 0.2.9

- A Helm filter in the sidebar shows only the repositories that hold Helm charts, in the tree, the repository lists and Recent. It shows once the poller has read a chart, with or without the PyPI source, beside All, Containers and Python. `/api/tagnames` lists those repositories in `helm`.

## Changes in 0.2.8

- A tag's page has a Pinned tag field beside Image and Pinned: `host/repo:tag@sha256:<digest>`, with a copy button. Pulling it checks the digest and keeps the tag name in the reference.

## Changes in 0.2.7

- Fixed: with PyPI only and no registry to reach, `/api/config` answered 502, so the page never learned that PyPI delete was on and hid it. The config now loads without a registry, with `deleteEnabled` null, and the "Deletion is disabled" notice shows only when the registry says so.

## Changes in 0.2.6

- Shift-click selects a range of tags for Delete selected: every row shown from the last one clicked to this one. A click on a row outside its links ticks it too.
- Settings sorts repositories, tags and Python packages separately. Repositories and packages sort by Name by default, tags by Recent push, with Version as the other choice. A sort picked in Settings before 0.2.6 is kept for repositories and packages.
- The Changed column of a tag list is now Pushed: when the poller saw the tag take its digest.
- Help shows garbage collection for a compose service too: `docker compose exec <service> registry garbage-collect`, with the service from the new `UI_REGISTRY_SERVICE` (`registry` in `compose.yml`).
- Delete Python package versions, several at once and with shift-click, from a package's version list. It needs a second GitLab token with the `api` scope in `secrets/gitlab_delete_token` (`compose.pypi-delete.yml`), never the read token. Without it the checkboxes are hidden and `POST /api/pypi/delete` answers 403. The call takes `{"ids"}`, at most 100 upload ids of this index, with the same CSRF, read-only and login checks as a tag delete.
- Fixed: the header said "live updated" with the time the page last redrew, which stood still while nothing changed. It now says "live, checked" with the time of the last completed walk of the registry, which moves with every walk, and its tooltip gives the last change seen.
- Settings, Refresh interval: a viewer can ask for a walk every 10, 15 or 30 seconds while their tab is open and visible. The shortest interval asked for applies to every viewer, never below `UI_POLL_MIN` (10, and never less than 10) and never slower than `UI_POLL_INTERVAL`. It ends when the tab is hidden or closed. The setting formerly called Fallback poll is now Poll while disconnected, as it applies only while the live stream is down.
- A thin line under the header runs down to the next refresh: the next walk of the registry, sent on the live stream so it follows `UI_POLL_INTERVAL`, the burst during a push and the back-off, or the fallback poll from Settings while the stream is down.

## Changes in 0.2.5

- Tags, folders and PyPI packages sort by Name unless Settings says otherwise. A sort picked in Settings is kept, and Reset to defaults goes back to Name. Browsers that stored Recent without it being picked now show Name, as the UI saved every setting together.

## Changes in 0.2.4

- Delete several tags at once. The tag list has a checkbox per row and one for every row shown, a count, and Delete selected. One dialog lists the tags, warns about tags that go too because they share a digest with a selected one, and offers to delete platform images when an index is selected. A second dialog lists each tag as deleted, skipped or failed with the reason.
- The new `POST /api/delete-tags` takes `{"repo", "tags", "children"}`, at most 100 tags. Each digest is deleted once, through the same checks as `/api/delete`: read-only mode, the login behind an auth proxy, the CSRF token, and the refusal to delete a platform of a tagged index. Indexes go before their children, so selecting both works.

## Changes in 0.2.3

- Fixed: changing the default sort in Settings did not reorder the PyPI packages in the tree until something was clicked. It now applies at once.
- A push in progress no longer shows as a 404. The registry lists a new repository once its first layer is uploaded, and its tags answer 404 until the manifest comes. The UI now says no tags yet, walks the registry every `UI_POLL_BURST` seconds (5) while such a repository waits, for at most `UI_POLL_BURST_MAX` seconds (600), and loads its tags as soon as they exist. `UI_POLL_BURST=0` turns this off.
- A failing registry backs off as before, also during a burst.
- Opening a repository whose push is still in progress starts the burst at once, instead of at the next walk. It shows the no-tags-yet message only, without the advice to delete an empty repository.
- Fixed: one repository the registry lists but cannot read (a push that never finished) stopped the first full walk from completing on a fresh state, so Recent and live updates never started.
- Fixed: a forced tag reload while an earlier read was still in flight returned that earlier answer.
- The release workflow publishes one run at a time per commit, so a tag pushed on the head of main no longer races the main run.

## Changes in 0.2.2

- Fixed: on an SELinux host, podman-compose mounted `secrets/gitlab_token` and `secrets/registry_password` without a label, so a token file under a home directory stopped the UI at start (`Permission denied: '/run/secrets/gitlab_token'`). `compose.pypi.yml` and `compose.registry-auth.yml` now bind-mount the file with `:ro,z`.
- A 401 from GitLab now says that a deploy token is refused by the packages API, and names the token types that work: a personal, group or project access token with `read_api`.
- A group that GitLab cannot find now points to the project form of `PYPI_INDEX_URL`, for a project path given as `GITLAB_GROUP`.
- The README says that the overrides add to the service `registry-lite-ui`: rename the container with `container_name`, not the service.

## Changes in 0.2.1

- The image is `ghcr.io/newen-systems/registry-lite-ui`. Images up to 0.2.0 stay at `ghcr.io/djlongy/registry-lite-ui`.
- `PYPI_INDEX_URL` names the PyPI source with the index URL pip is given, and it can be a project's index as well as a group's. `GITLAB_URL` with `GITLAB_GROUP` still works and is deprecated.
- Container tags in the tree are listed newest version first, as PyPI versions are.
- Releases come from a pushed tag `vX.Y.Z`. `latest` now means the latest release, main is `edge`, and each release also gets `X.Y` and `X`.

## Changes in 0.2.0

- An optional PyPI source (`compose.pypi.yml`): one GitLab group's PyPI packages beside the registry, with a type filter in the tree, one Recent list for both, PEP 440 version order, files with SHA-256, Requires-Python and wheel platforms, and pip or uv commands for Linux/macOS and Windows.
- Behind the OIDC override, PyPI data needs a login unless `UI_PYPI_PUBLIC=true`. Container data stays readable without one.
- Install commands leave out the token when GitLab serves the group index anonymously (`UI_PYPI_INDEX_AUTH=auto`), and a public group needs no token at all (an empty `secrets/gitlab_token`).
- Fixed: a long list could make the page itself scroll past the panel and leave an empty band below it.

## Changes in 0.1.1

- With the OIDC or LDAP override, anyone may browse without logging in. The header has a Log in button, and Copy to..., Move to... and Delete appear only after login. The UI refuses a change without a logged-in user (401), and oauth2-proxy refuses it first.
- OIDC logins use PKCE (S256).

## Features

- Tree browser of repositories and tags, with manifest detail (digest, size, layers, platforms of an index), Helm charts and a Created column.
- Pull, push and delete-from-a-script commands for podman or docker.
- Copy between repositories by blob mount and original manifest bytes, so digests do not change. Multi-arch indexes copy child by child.
- Move, which is a checked copy followed by a delete of the source.
- Promote between environments, configured with `UI_ENVIRONMENTS`.
- Delete with guards: every tag on the digest is listed first, and a digest that a tagged index lists as a child is refused.
- Live updates over Server-Sent Events, with a polling fallback, and a Recent changes view.
- A settings panel and a Help panel with the garbage collection commands.
- TLS for the UI and for the registry connection from an existing certificate.
- Optional auth overrides in front of the UI: basic auth, OIDC (oauth2-proxy) and LDAP (dex).
- A standalone `compose.ui.yml` for a registry that already runs as its own service.

## Security

The README "Security review" section lists the reviewers, the totals and what is open.

## Known limits

- The image is not signed, and a version tag can be re-pushed. Pin by digest.
- The OIDC and LDAP paths have no rate limit. Only the basic-auth override limits requests.
- There is no per-user authorisation and no audit log beyond the access line per request.
