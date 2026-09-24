# Release Checklist

Each release publishes two artifacts:

- npm package: `omploom`
- GitHub Release: [JAYY513/omploom](https://github.com/JAYY513/omploom)

After the initial bootstrap release, publishing is performed by GitHub Actions
with npm trusted publishing. No npm access token is stored in this repository
or in GitHub secrets.

## Verify the existing npm package

`omploom` is already published on npm. Confirm the package owner and current
version before changing the trusted-publisher configuration:

```bash
npm view omploom maintainers --registry https://registry.npmjs.org/
npm view omploom version --registry https://registry.npmjs.org/
```

The npm package owner must configure the trusted publisher in npm package
settings. The repository owner, workflow, and environment are the values below.

## One-time trusted-publisher setup

1. In npm, open the `omploom` package settings and add a **GitHub Actions**
   trusted publisher with:
   - Owner: `JAYY513`
   - Repository: `omploom`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
2. In GitHub, create the `npm` environment for this repository. Add required
   reviewers if releases need approval.
3. Confirm Actions is enabled for the repository.

The workflow at `.github/workflows/publish.yml` requests `contents: write` to
create the GitHub Release and `id-token: write` for trusted publishing. It
installs npm 11.5.1 or newer, as required for trusted publishing. The OIDC
permission lets npm verify the GitHub Actions identity and generate provenance
for the published package.


## Release later versions

Run these from a clean `main` checkout after the release changes are merged.

```bash
npm ci
npm test
npm run build
npm version <major|minor|patch>
git push origin main --follow-tags
```

`npm version` updates `package.json` and `package-lock.json`, creates a commit,
and creates a `v<version>` tag. Review the generated commit before pushing.

Pushing the tag starts the `Publish npm package` workflow. It checks out that
immutable tag, verifies the tag matches `package.json`, installs from the
lockfile, runs tests and the production build, then creates a draft GitHub
Release with generated notes. It publishes `omploom` through the configured
trusted publisher and makes that release public only after npm accepts the
package. A rerun can safely finish a release if npm has already accepted its
version.

If a tag push does not start the workflow, manually retry the existing tag from
the current default branch:

```bash
gh workflow run publish.yml --repo JAYY513/omploom --ref main -f tag=v<version>
```

## Verify

```bash
gh run list --repo JAYY513/omploom --workflow publish.yml --limit 1
npm view omploom@<version> version --registry https://registry.npmjs.org/
npm view omploom@<version> --json --registry https://registry.npmjs.org/
```

Confirm the workflow succeeded, the exact package version resolves, and npm
shows the expected provenance link.
