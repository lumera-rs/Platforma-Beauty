export type ApiGeneratorOutput = Readonly<{
  source: string;
  published: string;
}>;

export const apiOutputInventory: Readonly<{
  publicDocumentation: readonly string[];
  generators: Readonly<Record<string, ApiGeneratorOutput>>;
}>;

export function assertApiGeneratorInventoryComplete(
  configuredGeneratorNames: readonly string[],
): void;

export function defineInventoriedGeneratorConfig<const Config extends Readonly<Record<string, unknown>>>(
  config: Config,
): Config;