# Updates

Once set up, you never reinstall by hand:

1. A new version is pushed to GitHub with a version tag (for example `v1.0.5`).
2. GitHub builds the Windows installer on its own Windows machines. It runs the tests, bundles the SHA-256-verified GCS and publishes a GitHub Release.
3. Every installed copy checks for updates when it starts and every 4 hours. A new version downloads in the background.
4. The GM gets a dialog with two choices:
   * **Restart and update now**: the campaign is saved, the update installs silently and the app reopens.
   * **Later**: the update installs the next time you close the app.

Your campaigns live in `%APPDATA%\STALKER GURPS Companion\campaign-data\` and are never touched by updates. Players who connect through a browser always use whatever version the GM runs, so they never update anything.

Menu **Help → Check for updates…** checks right away. **Help → Restart to install** installs a downloaded update.

## One-time setup (5 minutes)

The source repository is private. An app can't read releases from a private repository without a secret, and a secret shipped inside the app would leak. So installers are published to a small **public** repository that contains only the finished `.exe` files. Your code stays private.

1. **Create the releases repository.**
   * On GitHub, create a new **public**, empty repository named `stalker-gurps-companion-releases` under your account (`Tresdiablo`).
   * To use a different name, change `build.publish` in `package.json` to match.
2. **Create a token that can publish there.**
   * Go to GitHub → Settings → Developer settings → Fine-grained personal access tokens → *Generate new token*.
   * Under **Repository access**, choose *Only select repositories* and pick `stalker-gurps-companion-releases`.
   * Under **Permissions**, set **Contents: Read and write**.
3. **Store the token as a secret.**
   * In your **private** repository `Stalker-gurps-companion`, go to Settings → Secrets and variables → Actions → *New repository secret*.
   * Name it `RELEASES_TOKEN` and paste the token as the value.
4. **Install once from a release.** After the first published release, install that `.exe` once. Every version after that updates itself.

Until steps 1–3 are done, the workflow still builds the installer but doesn't publish it. You can download it from the workflow run on the **Actions** tab: open the run and look under *Artifacts*. Copies installed that way won't update themselves; they'll show "update check failed" in the GM notices, which is harmless.

## Publishing a new version

1. Bump `"version"` in `package.json`, for example `1.0.4` → `1.0.5`.
2. Commit the change.
3. Run `git tag v1.0.5 && git push origin v1.0.5`.

The **Windows installer** workflow does the rest, in about 10–15 minutes. You can also start it by hand from the Actions tab (*Run workflow*). A manual run builds whatever `package.json` says.

The version must be higher than the installed one, or the app ignores it.

## Notes

* Installers are not code-signed. On first install Windows SmartScreen may say "Windows protected your PC": choose *More info → Run anyway*. Updates after that install silently. Signing needs a paid certificate; electron-builder supports one if you get one later.
* `INSTALL_WINDOWS.cmd` still works for building on your own PC. Copies installed that way also auto-update once releases exist.
