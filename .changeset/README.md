# Changesets

Every user-visible change ships with a changeset file in this directory
(`npx changeset`). On merge to `main`, the release workflow turns the pending
changesets into a "Version Packages" pull request; merging that PR publishes
the bumped packages to npm. See "Releases" in `AGENTS.md` and
"Contributing" in `README.md`.
