import type { MigrationManifestEntry } from "./types";

export const SUPPORTED_STARTUP_ADMISSION_CONTRACT = "supported-startup-v1" as const;

export const supportedStartupMigration: MigrationManifestEntry & {
  readonly admissionContract: typeof SUPPORTED_STARTUP_ADMISSION_CONTRACT;
} = {
  id: "000002",
  directory: "000002_supported_startup_state",
  checksum: "a8c910eb9bd60281aa80e343b4b1d6e02a45222293b123ab198fab4315d48e62",
  mode: "transactional",
  description: "Apply the admitted supported startup data state",
  structuralFingerprint: "938c62183adabae9fdab00c5d968c39feb3f216e521b9031d1642575f5875cad",
  physicalFingerprint: "673f3810d49a4be6899482d44281607dac06d3e1012cd001e8348a45fdf5ea1f",
  fingerprintVersion: 4,
  formatVersion: 2,
  postgresMajor: 16,
  postgresVersionNum: 160010,
  normalizedObjectCount: 5060,
  enumCount: 103,
  triggerCount: 24,
  functionCount: 21,
  admissionContract: SUPPORTED_STARTUP_ADMISSION_CONTRACT,
};