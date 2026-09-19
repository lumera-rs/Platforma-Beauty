# Historical startup-operation source fixture

This directory preserves the source inputs used by the pre-removal historical
operation generator. It is not a Git bundle and contains no Git objects,
attachments, agent metadata, environment files, or database state.

The historical commit identifier is provenance only. Ordinary tests must not
fetch, resolve, or archive that commit.

The manifest inventories the original source paths, byte lengths, and SHA-256
checksums. The compressed payload contains those exact source bytes. Fixture
materialization verifies both before running the original historical generator.

The expected generated crosswalk SHA-256 remains
`174ebf6e31fd8f7c53ea5e1112518a2afd2d56e72c3762e796e139a8a43b90a3`.
The original matrix assertions are preserved, including all 67 historical
records and the deliberately BLOCKED global-equivalence boundary.

## Complete input closure

The payload contains 442 original files (12,562,259 source bytes), not just the
eight startup-owner files. The manifest records every path and digest, 26
directories, 11 observed directory listings, and 155 absent resolution probes.
The closure includes:

- The unchanged historical generator and its two local supporting modules.
- The original startup-inventory baseline and canonical migration SQL.
- The inventory resolver's locally reachable source graph, including workspace
  package manifests and package-export resolution inputs.
- The complete source/test directory entries inspected by the caller-evidence
  scans, including all inspected `.test.ts` files.
- Root/scripts package and TypeScript configuration required by the loader.

Only the three generator modules are executed. Application modules, SQL,
shell scripts, and test-source inputs inside the payload are read as data, not
executed. Installed TypeScript/tsx packages remain normal toolchain dependencies,
not historical-source payload.

## Provenance and equivalence

Preparation used the historical source at
`815465404f7ed530cdb79446bfcba68e5dc1821b`. An isolated run of its original
generator reproduced the existing 7,377,721-byte crosswalk and immutable digest.
File reads, resolution probes, and directory enumeration were recorded while
that generator ran. The recorded closure was then materialized without a Git
repository and replayed against the same original generator.

The payload is deterministic gzip (zero timestamp) of a JSON file inventory
with base64-encoded original bytes. No source rewriting or generated crosswalk
substitution is involved. The separately pinned manifest protects the payload
digest, file inventory, individual byte lengths/digests, and provenance records.
The materializer validates the entire payload before writing into an empty
temporary directory. Missing or modified inputs fail closed.

Run the existing historical-operation-matrix test through
`pnpm run test:migrations:phase5:unit`. It regenerates evidence from this source
fixture and keeps all original digest, count, applicability, SQL/excerpt, and
runtime-operation assertions. It does not invoke Git, fetch history, connect to
a database, or execute application startup.

Fixture regeneration is a separate, explicit review operation: obtain the
original source, capture its complete input closure under the original
generator, verify every input against that source, and reproduce the unchanged
crosswalk digest before updating any fixture pins. Never change the expected
crosswalk digest merely to make a reconstructed fixture pass. The historical
source SHA is descriptive provenance, not a runtime dependency or fetch target.