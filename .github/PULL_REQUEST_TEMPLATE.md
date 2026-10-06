**What and why**

**Checklist**

- [ ] `npm run check` is green against a freshly built core
- [ ] no Hatch logic in the extension: anything about patches is asked of the core
- [ ] every failure is an exact place, a named approximation or a refusal with a next step
- [ ] a new `hatch.*` setting has its `generate.*` config key (E1)
- [ ] the protocol range is compared as a range, never for equality (R9)
- [ ] `README.md` and `README.ru.md` (and `CONTRIBUTING*.md`) changed together, if at all
- [ ] a user-visible change has its line in `CHANGELOG.md` under *Unreleased*
