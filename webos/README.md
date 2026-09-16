# `webos/` — the LG TV app

Four files and a redirect. This directory is the whole webOS app: it puts a
**Pitch Snake** tile on an LG TV's home screen, and that tile opens
`https://pitchsnake.com/?tv=1`.

```
appinfo.json    what the TV needs to list and launch the app
index.html      one line: redirect to the live site
icon.png        80x80, the home-row tile
largeicon.png   130x130, the focused tile
```

## Why it is a redirect and not the game

Because this repository already has exactly one deploy, and a second one would
rot. GitHub Pages serves the checkout as it stands, so a push is the deploy;
an `.ipk` sitting on a television is a **copy**, and copies here have a known
failure. A room refuses any peer whose `ENGINE_VERSION` differs, so a bundled
engine that has fallen a version behind cannot join a room and cannot have a
score validated, and it fails that way silently. `checkBuild()` exists in the
page for precisely this and can only fix a page that is fetched; it cannot fix
a bundle.

The mobile app has this problem for real (it bundles the engine at build time,
which is why its gate says "update the app" rather than offering RELOAD). The
TV does not have to inherit it. A redirect means the television is always on
the same build as every browser, the `?v=` content hashes keep working
untouched, and shipping a fix to the TV is the push you were making anyway.

The cost is that the app needs the network to start. For a game whose boards,
rooms and identity are all online, that is not much of a cost.

The redirect targets **pitchsnake.com** and not the `github.io` origin on
purpose: the localStorage migration in `index.html` fires on the old host and
would bounce the app through a hand-off it has no reason to make.

## Turning the TV on

Both routes below need this first, and only this is done on the television.

**LG Content Store → search "Developer Mode" → install → open → sign in with
your LG developer account → Developer Mode ON.** The app then shows the TV's
IP address, and a **Key Server** button that displays a passphrase. Leave that
on screen while you register the device; the passphrase is case sensitive.

The numbers a TV wants are not the SSH defaults, and LG's own older extension
guide still prints the wrong ones:

| | |
|---|---|
| port | **9922**, not 22 |
| username | **prisoner**, not root |

## Route A: webOS Studio in VS Code

The extension does NOT bundle LG's CLI; it installs the same global packages
this repo's script calls, so the two routes are the same tools with different
buttons and either can be used at any time.

1. **`webOS: Install Global Packages`** from the command palette, which runs
   `npm install -g @enact/cli @webos-tools/cli patch-package`.
2. **`webOS: Set Device Profile`** → TV. (It is the default, but it is the
   setting that decides whether `ares-*` talks to a TV or to Open Source
   Edition, so it is worth confirming rather than assuming.)
3. Open **this repository's root** as the workspace, not `webos/`. webOS
   Studio allows only one workspace at a time, and the TV's actual behaviour
   lives in `page/tv-remote.ts` out here, not in the four files in there.
   Then add the app with the **import** button in **APPS IN WORKSPACE** and
   point it at `webos/`. The `+` button beside it generates a NEW app from a
   template, which is not what this is.
4. Add the TV in **KNOWN DEVICE** with the `+` button: a name, the IP, port
   9922, username `prisoner`.
5. Press **Key Server** on the TV, then run **`webOS TV: Set Up SSH Key`** and
   type the passphrase it is showing.
6. **Run App** packages, installs and launches in one go.

## Route B: the command line

```sh
npm install -g @webos-tools/cli          # the same package the extension installs
ares-config --profile tv                 # the same setting as Set Device Profile
```

Then, from the repository root:

```sh
npm run webos:package                     # writes webos/build/com.pitchsnake.app_1.0.0_all.ipk
ares-setup-device                         # add the TV once: IP, port 9922, user prisoner
ares-novacom --device tv --getkey         # then type the Key Server passphrase
ares-install --device tv webos/build/com.pitchsnake.app_1.0.0_all.ipk
ares-launch --device tv com.pitchsnake.app
```

`--getkey` prompts `input passphrase [default: webos]`. **Do not press enter
there.** The default in the square brackets is not your passphrase, it is a
placeholder, and accepting it fails later as an unhelpful SSH error rather
than as a wrong password. Type the six-ish characters the TV's Key Server
panel is showing.

`ares-setup-device --list` confirms the TV is registered, and
`ares-install --device tv --list` confirms the app landed.

Neither route needs an emulator or a simulator, and on an Apple Silicon Mac
the **Emulator does not run at all** (the Simulator does, from webOS TV 25,
and is ARM64 only). None of that matters with a real television on the
network, which is the only thing this app has ever been tested against.

## The thing that will catch you out

**Developer Mode expires and takes the app with it.** The key-server session
lasts about 50 hours, and the mode itself runs on a 1000-hour budget; when
either lapses the TV removes every app installed this way. Re-open the
Developer Mode app and extend the session, or reinstall.

That timer is the reason to publish through LG Seller Lounge if this is meant
to stay on the television: a store-installed app has no expiry. Submission
wants store metadata, 1920x1080 screenshots, a UX scenario and a self
checklist, and technical review runs roughly 5 to 10 business days.

## What the page does differently on a TV

Nothing in this directory. The page recognises a television itself, in
`page/tv-remote.ts`, and that is where the remote's three keys are wired. See
the module's own doc block; the short version is that a remote is a gamepad
with fewer buttons, so it feeds the same verbs in `page/menu-nav.ts` that the
gamepad has used all along.

To see that mode without a television, open the site with `?tv=1`. The arrow
keys and Enter then stand in for the remote's own.

`node scripts/check-tv-remote.mjs` drives exactly that in a real browser and
asserts the things a television cannot be shipped without: the ring is drawn
and lands inside whatever panel is open, BACK closes it, OK both selects and
pauses, and the arrow keys belong to the shell mid-round and to the remote in
a menu. It needs Chrome and wants the machine to itself, like every other
`check-*.mjs` here, so it is a pre-flight rather than a CI job.
