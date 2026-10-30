registry-lite-ui is a web UI for a plain `registry:2` that browses, copies, moves, promotes and deletes images through the registry's own HTTP API, and optionally browses one GitLab group's PyPI packages.

## Run it

`podman-compose up -d` with `compose.yml` (registry and UI), or `podman-compose -f compose.ui.yml up -d` with `REGISTRY_URL` set for a registry that already runs. `docker compose` works the same way. Pin `UI_IMAGE` to a version or a digest in your `.env`.

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
