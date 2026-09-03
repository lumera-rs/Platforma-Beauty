export type ApiGeneratorOutput = Readonly<{
  source: string;
  published: string;
}>;

export const orvalFileProducingOutputOptions: readonly string[];
export const orvalNonFileOutputOptions: readonly string[];
export const orvalNestedOutputContracts: Readonly<Record<string, Readonly<{
  configPath: string;
  fileProducing: readonly string[];
  nonFile: readonly string[];
}>>>;

export function assertOrvalOutputContractRecognized(
  installedOutputOptions: readonly string[],
): void;

export function assertOrvalNestedOutputContractsRecognized(
  installedContracts: Readonly<Record<string, readonly string[]>>,
): void;

export const apiOutputInventory: Readonly<{
  publicDocumentation: readonly string[];
  generators: Readonly<Record<string, ApiGeneratorOutput>>;
}>;

export function assertApiGeneratorInventoryComplete(
  configuredGeneratorNames: readonly string[],
): void;

export function assertApiGeneratorOutputPathsCovered(
  config: Readonly<Record<string, unknown>>,
  outputRoot?: string,
): void;

export function defineInventoriedGeneratorConfig<const Config extends Readonly<Record<string, unknown>>>(
  config: Config,
  outputRoot?: string,
): Config;