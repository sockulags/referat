# Code signing policy (draft — pending SignPath approval)

This is the code signing policy prepared for the SignPath Foundation OSS
application. Once approved, this content moves to the website download section
and the wiki, per SignPath's disclosure requirements.

## Policy text (English, for site + wiki)

> **Code signing policy**
>
> Free code signing provided by [SignPath.io](https://signpath.io), certificate
> by [SignPath Foundation](https://signpath.org).
>
> Binaries are built from source in a verifiable way by GitHub Actions
> (`.github/workflows/release-build.yml`) from the public repository
> [sockulags/referat](https://github.com/sockulags/referat). Every release is
> manually approved for signing.
>
> **Team roles**
> - Author, Reviewer, Approver: Lucas Skog ([@sockulags](https://github.com/sockulags))
>
> **Privacy**: referat does not transfer any data to any third party. The app
> makes network requests only to the AI endpoints the user explicitly
> configures. There is no telemetry.

## Application answers (copy-paste for signpath.org/apply)

- **Project name**: referat
- **Project URL**: https://github.com/sockulags/referat
- **Website**: https://sockulags.github.io/referat/
- **License**: MIT (OSI-approved, no dual licensing)
- **Description**: Windows desktop app for local-first meeting recording,
  transcription and meeting minutes. Users choose where the AI runs (local
  machine, company server, or cloud provider); recordings and minutes never
  leave the machine unless the user configures an external endpoint.
- **Build system**: GitHub Actions (windows-latest), electron-builder;
  workflow `.github/workflows/release-build.yml` builds the NSIS installer
  from source on version tags.
- **Team**: single maintainer, Lucas Skog (@sockulags); 2FA enabled on GitHub
  and will be enabled on SignPath.
- **Artifact to sign**: NSIS installer (`referat-<version>-setup.exe`) and the
  binaries inside it.

## Checklist before submitting

- [ ] GitHub 2FA enabled (verify at https://github.com/settings/security)
- [ ] Create SignPath account (must be done by Lucas — requires login/2FA)
- [ ] Submit the form at https://signpath.org/apply with the answers above
- [ ] After approval: install the SignPath GitHub integration, replace the
      self-signed step, publish the policy text on the site download section
      and wiki, and re-release.
