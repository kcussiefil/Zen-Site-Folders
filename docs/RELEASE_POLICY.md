# Release and documentation policy

## Language and layout

- Primary public `README.md`: concise English project overview.
- `README.zh-TW.md`: maintained Traditional Chinese user guide.
- `CHANGELOG.md`: brief version index; detailed historical facts belong in the existing `releases/vX.Y.Z.md`.
- **New** release notes: English, with a consistent title and headings. Do not mix languages within one release description, except UI labels that must be quoted verbatim.
- Never place sequential release logs or old implementation plans at the top of `README.md`.

## New release checklist

1. Confirm behavior changes and complete relevant automated and Zen/Zia tests.
2. Update `theme.json` version and its required Sine metadata together.
3. Add one `releases/vX.Y.Z.md`: title, `Changes`, `Compatibility / known limitations`, `Verification` and `Rollback` where relevant.
4. Update the small index in `CHANGELOG.md` and any current-version reference in both READMEs.
5. Review the Git diff for unexpected runtime, CSS, tests, or metadata changes before pushing.

The GitHub publisher watches `theme.json`, `releases/**` and its own workflow file on `main`. It **skips a release tag already published**. Changing only README / CHANGELOG / this policy **does not publish a release**. Old release bodies may be revised separately using the GitHub Releases editor; editing past Markdown note files alone does not retroactively edit their published release descriptions.

## Safety rules

- Do not bump `theme.json` or `updatedAt` for documentation-only corrections.
- Do not rewrite historical tags or delete past release notes.
- Changes to tests, CSS, scripts or workflows need a separate scoped change and verification.
- A documented test plan is not a claim of successful macOS hardware acceptance.
