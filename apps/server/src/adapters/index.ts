// Each provider gets a directory here (gmail/, icloud/, …) implementing the
// contract in types.ts. Concrete adapter instances are re-exported from this
// barrel; the CLI and runner consume adapters through it.
export { gmailAdapter, gmailCapabilities } from './gmail/index.ts';
