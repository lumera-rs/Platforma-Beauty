export const apiOutputInventory = Object.freeze({
  publicDocumentation: Object.freeze([
    "lib/api-spec/openapi.yaml",
  ]),
  generators: Object.freeze({
    "api-client-react": Object.freeze({
      source: "lib/api-client-react/src/generated",
      published: "lib/api-client-react/dist/generated",
    }),
    zod: Object.freeze({
      source: "lib/api-zod/src/generated",
      published: "lib/api-zod/dist/generated",
    }),
  }),
});

export function assertApiGeneratorInventoryComplete(configuredGeneratorNames) {
  const configured = new Set(configuredGeneratorNames);
  const inventoried = new Set(Object.keys(apiOutputInventory.generators));
  const missingFromInventory = [...configured].filter((name) => !inventoried.has(name)).sort();
  const missingFromConfiguration = [...inventoried].filter((name) => !configured.has(name)).sort();
  const incompleteOutputs = [...configured]
    .filter((name) => {
      const output = apiOutputInventory.generators[name];
      return output && (!output.source || !output.published);
    })
    .sort();

  if (
    missingFromInventory.length === 0
    && missingFromConfiguration.length === 0
    && incompleteOutputs.length === 0
  ) {
    return;
  }

  throw new Error([
    "Orval generators and the API output safety inventory are out of sync.",
    ...missingFromInventory.map((name) =>
      `  - ${name}: add both source and published outputs to apiOutputInventory.generators`,
    ),
    ...missingFromConfiguration.map((name) =>
      `  - ${name}: remove its stale API output inventory entry or restore its Orval target`,
    ),
    ...incompleteOutputs.map((name) =>
      `  - ${name}: inventory both non-empty source and published outputs`,
    ),
  ].join("\n"));
}

export function defineInventoriedGeneratorConfig(config) {
  assertApiGeneratorInventoryComplete(Object.keys(config));
  return config;
}