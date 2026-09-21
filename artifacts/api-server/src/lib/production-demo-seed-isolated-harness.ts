/**
 * Disposable, database-free harness for the production demo-fixture boundary.
 *
 * The child process replaces @workspace/db with a virtual in-memory adapter.
 * The only value this harness imports from the real package is the query
 * observation header constant, from a module with no imports of its own that
 * opens no connection.  The adapter records every mutation, so the HTTP
 * assertions can distinguish an actual no-op from a test which merely
 * inspected source text.  DATABASE_URL is removed from the child process
 * before it starts; importing index.ts is also intentionally avoided because
 * index.ts owns startup work.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { build, type Plugin, type PluginBuild } from "esbuild";
import { databaseQueryObservationHeader } from "@workspace/db/query-observation";

const execFileAsync = promisify(execFile);
const apiServerRoot = path.resolve(import.meta.dirname, "..", "..");
const workspaceRoot = path.resolve(apiServerRoot, "..", "..");
const appPath = path.join(apiServerRoot, "src", "app.ts");
const tsxPath = path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");

export type IsolatedDbMode = "empty" | "existing" | "registration";

export type IsolatedWrite = {
  operation: string;
  table: string;
  rows: unknown[];
};

export type IsolatedDbSnapshot = {
  mode: IsolatedDbMode;
  users: Array<{ id: string; email: string; role: string }>;
  salons: Array<{ id: string; slug: string; name: string }>;
  rowsByTable: Record<string, unknown[]>;
  writes: IsolatedWrite[];
};

type ChildResult = { code: number; stdout: string; stderr: string };

const existingUser = {
  id: "real-user-1",
  firstName: "Stvarna",
  lastName: "Korisnica",
  email: "real@example.test",
  phone: "+381612345679",
  phoneNormalized: "381612345679",
  dateOfBirth: null,
  passwordHash: "not-a-valid-scrypt-hash",
  passwordSetAt: new Date("2026-01-01T00:00:00.000Z"),
  role: "CUSTOMER",
  active: true,
  mustChangePassword: false,
  marketingEmailsEnabled: true,
};

const existingSalon = {
  id: "real-salon-1",
  ownerId: existingUser.id,
  name: "Stvarni salon",
  slug: "real-salon",
  city: "Beograd",
  municipality: "Vračar",
  postalCode: "11000",
  address: "Stvarna 1",
  phone: "+381110000001",
  email: "salon@example.test",
  shortDescription: "Stvarni salon za izolovanu proveru.",
  description: "Stvarni salon čiji podaci ne smeju da se menjaju.",
  imageUrl: "/real-salon.jpg",
  coverImageDescription: null,
  gallery: [],
  videoUrl: null,
  rating: 48,
  reviewCount: 12,
  active: true,
  isVerified: true,
  featured: false,
  topSalon: false,
  acceptsCards: true,
  instantBooking: true,
  servesMen: false,
  servesMenManuallySet: true,
  homeServiceRadiusKm: 5,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const existingEmployee = {
  id: "real-employee-1",
  salonId: existingSalon.id,
  userId: null,
  name: "Stvarna Zaposlena",
  role: "Frizerka",
  bio: "Stvarna zaposlena za izolovanu proveru.",
  avatarUrl: "/real-employee.jpg",
  email: "employee@example.test",
  specialties: ["Šišanje"],
  canOrderIndependently: false,
  active: true,
};

const existingAssignment = {
  id: "real-assignment-1",
  employeeId: existingEmployee.id,
  salonId: existingSalon.id,
  active: true,
  isDefault: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const existingService = {
  id: "real-service-1",
  salonId: existingSalon.id,
  categoryId: null,
  categoryName: "Šišanje",
  name: "Stvarno šišanje",
  description: "Stvarna usluga za izolovanu proveru.",
  preProcessingMinutes: 0,
  processingMinutes: 0,
  postProcessingMinutes: 0,
  seatCapacity: 1,
  requiredEmployeeCount: 1,
  depositAmount: null,
  bufferMinutes: 0,
  durationMinutes: 60,
  price: 2400,
  promoPrice: 2100,
  tags: ["stvarna"],
  packageTreatments: null,
  imageUrl: "/real-service.jpg",
  active: true,
  homeServiceAvailable: false,
  homeServiceFee: 0,
  homeServiceMinimumOrder: null,
};

const existingEmployeeService = {
  id: "real-employee-service-1",
  employeeId: existingEmployee.id,
  serviceId: existingService.id,
};

const existingSalonHour = {
  id: "real-salon-hour-1",
  salonId: existingSalon.id,
  weekday: 1,
  openTime: "09:00",
  closeTime: "17:00",
  closed: false,
};

const existingSalonCustomer = {
  id: "real-salon-customer-1",
  salonId: existingSalon.id,
  userId: existingUser.id,
  firstName: existingUser.firstName,
  lastName: existingUser.lastName,
  email: existingUser.email,
  phone: existingUser.phone,
  phoneNormalized: existingUser.phoneNormalized,
  smsOptOut: false,
  birthDate: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const existingProductCategory = {
  id: "real-product-category-1",
  supplierId: "real-supplier-1",
  name: "Stvarna nega",
  slug: "stvarna-nega",
  parentId: null,
  sortOrder: 1,
  icon: null,
  imageUrl: null,
  active: true,
};

const existingProduct = {
  id: "real-product-1",
  supplierId: existingProductCategory.supplierId,
  categoryId: existingProductCategory.id,
  categoryName: existingProductCategory.name,
  subcategoryName: null,
  name: "Stvarni proizvod",
  brand: "Stvarni brend",
  description: "Stvarni proizvod za izolovanu proveru.",
  shortDescription: "Stvarni proizvod",
  imageUrl: "/real-product.jpg",
  coverImageDescription: null,
  images: [],
  price: 1800,
  costPriceRsd: 900,
  averageDurationDays: null,
  discountPrice: 1500,
  discountPriceEndsAt: null,
  retailEnabled: true,
  publicDescription: "Stvarni javni proizvod.",
  publicPrice: 1800,
  publicDiscountPrice: 1500,
  publicDiscountPriceEndsAt: null,
  productTypeId: null,
  ingredients: null,
  usageInstructions: null,
  characteristics: [],
  searchSynonyms: [],
  professionalEnabled: true,
  stock: 8,
  catalogReference: "REAL-PRODUCT-1",
  sku: "REAL-SKU-1",
  unit: "kom",
  weightGrams: 100,
  isNew: false,
  isBestseller: true,
  variantType: null,
  variants: null,
  similarProductsMode: "AUTO_CATEGORY",
  similarProductIds: [],
  crossSellProductIds: [],
  quantityPricingTiers: [],
  minimumOrderQuantity: 1,
  deliveryBusinessDaysOverride: null,
  subscriptionAllowed: false,
  subscriptionDiscountPercent: null,
  loyaltyPricingExcluded: false,
  priceOnRequest: false,
  bulkMatrixEnabled: false,
  averageRating: 48,
  reviewCount: 3,
  active: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function databaseImportNames(sourceFiles: string[]): Set<string> {
  const names = new Set([
    "db",
    "pool",
    "closePool",
    "databasePoolStats",
    "getPoolStatus",
    "isDatabaseQueryObservationRuntimeAllowed",
    "runWithDatabaseQueryObservation",
    "databaseQueryObservationHeader",
    "assertDestructiveTestRuntimeAllowed",
    "isProductionOrDeploymentRuntime",
    "getInertDatabaseSnapshot",
  ]);
  const importPattern = /import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*["']@workspace\/db(?:\/[^"']+)?["']/g;
  for (const source of sourceFiles) {
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(source)) !== null) {
      for (const part of match[1]!.split(",")) {
        const cleaned = part.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/g, "").trim();
        if (!cleaned || cleaned.startsWith("type ")) continue;
        const localName = cleaned.split(/\s+as\s+/).at(-1)?.trim();
        if (localName && /^[A-Za-z_$][\w$]*$/.test(localName)) names.add(localName);
      }
    }
  }
  return names;
}

function inertDbModuleSource(names: Set<string>): string {
  const exports = [...names]
    .filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name))
    .sort()
    .map((name) => `export const ${name} = __values.${name};`)
    .join("\n");

  return `
import { createHash as inertCreateHash } from "node:crypto";

const mode = process.env.LUMERA_INERT_DB_MODE || "empty";
const productionOrDeployment = process.env.NODE_ENV === "production"
  || process.env.REPLIT_DEPLOYMENT === "1"
  || process.env.REPL_DEPLOYMENT === "1";
const writeLog = [];
const users = mode === "existing" ? [${JSON.stringify(existingUser)}] : [];
const salons = mode === "existing" ? [${JSON.stringify(existingSalon)}] : [];
const employees = mode === "existing" ? [${JSON.stringify(existingEmployee)}] : [];
const employeeLocationAssignments = mode === "existing" ? [${JSON.stringify(existingAssignment)}] : [];
const services = mode === "existing" ? [${JSON.stringify(existingService)}] : [];
const employeeServices = mode === "existing" ? [${JSON.stringify(existingEmployeeService)}] : [];
const salonHours = mode === "existing" ? [${JSON.stringify(existingSalonHour)}] : [];
const salonCustomers = mode === "existing" ? [${JSON.stringify(existingSalonCustomer)}] : [];
const productCategories = mode === "existing" ? [${JSON.stringify(existingProductCategory)}] : [];
const products = mode === "existing" ? [${JSON.stringify(existingProduct)}] : [];
const verification = mode === "registration" ? {
  id: "verification-1",
  phoneNormalized: "381612345678",
  codeHash: process.env.LUMERA_INERT_DB_VERIFICATION_HASH
     || inertCreateHash("sha256").update("123456").digest("hex"),
  expiresAt: new Date(Date.now() + 600000),
  attempts: 0,
} : null;
const tableCache = new Map();
const tableName = (name) => name.endsWith("Table") ? name.slice(0, -5) : name;
const table = (name) => {
  const cached = tableCache.get(name);
  if (cached) return cached;
  const value = new Proxy({}, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      if (property === "__tableName") return tableName(name);
      if (property === "$inferSelect" || property === "$inferInsert") return {};
      return { __columnTable: tableName(name), __columnName: String(property) };
    },
  });
  tableCache.set(name, value);
  return value;
};

const tableOf = (value) => value && typeof value === "object" && typeof value.__tableName === "string"
  ? value.__tableName
  : "";

const rowsFor = (name) => {
  if (name === "users") return users;
  if (name === "salons") return salons;
  if (name === "employees") return employees;
  if (name === "employeeLocationAssignments") return employeeLocationAssignments;
  if (name === "services") return services;
  if (name === "employeeServices") return employeeServices;
  if (name === "salonHours") return salonHours;
  if (name === "salonCustomers") return salonCustomers;
  if (name === "productCategories") return productCategories;
  if (name === "products") return products;
  if (name === "phoneVerificationCodes") return verification ? [verification] : [];
  return [];
};

const project = (rows, selection, baseName, joinedName) => {
  if (!selection || typeof selection !== "object") return rows;
  return rows.map((row) => Object.fromEntries(Object.entries(selection).map(([key, expression]) => {
    if (expression && typeof expression === "object" && expression.__tableName) {
      const selectedTable = expression.__tableName;
      if (selectedTable === baseName) return [key, row];
      const joinedRows = rowsFor(selectedTable);
      const joinedRow = joinedRows.find((candidate) =>
        candidate.id === row.employeeId
        || candidate.id === row.userId
        || candidate.id === row.serviceId
        || candidate.salonId === row.salonId,
      ) ?? joinedRows[0];
      return [key, joinedRow];
    }
    if (expression && typeof expression === "object" && expression.__columnName) {
      return [key, row[expression.__columnName]];
    }
    return [key, undefined];
  })));
};

const selectQuery = (selection) => {
  let name = "";
  let joinName = "";
  const query = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve, reject) => Promise.resolve(project(rowsFor(name), selection, name, joinName)).then(resolve, reject);
      }
      if (property === "catch") return (reject) => Promise.resolve(project(rowsFor(name), selection, name, joinName)).catch(reject);
      if (property === "finally") return (callback) => Promise.resolve(project(rowsFor(name), selection, name, joinName)).finally(callback);
      return (...args) => {
        if (property === "from" || property === "innerJoin" || property === "leftJoin") {
          if (property === "from") name = tableOf(args[0]) || name;
          else joinName = tableOf(args[0]) || joinName;
        }
        return query;
      };
    },
  });
  return query;
};

const mutation = (operation, target) => {
  const name = tableOf(target);
  let input = [];
  let result = [];
  const query = {
    values(value) {
      input = Array.isArray(value) ? value : [value];
      if (operation === "insert") {
        writeLog.push({
          operation: name === "customerPasswordSetupRateLimits" ? "auth-rate-limit-write" : operation,
          table: name,
          rows: input,
        });
        if (name === "users") {
          result = input.map((row, index) => ({
            id: "registered-user-" + (index + 1),
            ...row,
            dateOfBirth: row.dateOfBirth ?? null,
            active: true,
            mustChangePassword: false,
            marketingEmailsEnabled: true,
          }));
          users.push(...result);
        }
      }
      return query;
    },
    set(value) {
      writeLog.push({
        operation: name === "customerPasswordSetupRateLimits" ? "auth-rate-limit-write" : "update",
        table: name,
        rows: [value],
      });
      return query;
    },
    where() { return query; },
    returning() { return Promise.resolve(result); },
    onConflictDoNothing() { return query; },
    onConflictDoUpdate() { return query; },
    for() { return query; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    catch(reject) { return Promise.resolve(result).catch(reject); },
    finally(callback) { return Promise.resolve(result).finally(callback); },
  };
  return query;
};

const rawQueryText = (query) => {
  if (typeof query === "string") return query;
  if (query && typeof query.text === "string") return query.text;
  if (query && typeof query.query === "string") return query.query;
  if (query && Array.isArray(query.queryChunks)) {
    return query.queryChunks.map((chunk) => {
      if (typeof chunk === "string") return chunk;
      if (chunk && typeof chunk.value === "string") return chunk.value;
      if (chunk && typeof chunk.name === "string") return chunk.name;
      return "";
    }).join(" ");
  }
  return "";
};
const executeRawQuery = (query, source) => {
  const text = rawQueryText(query).trim();
  if (!text) throw new Error("Isolated database adapter could not classify raw SQL.");
  if (/\\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke)\\b/i.test(text)) {
    if (/customer[_ ]password[_ ]setup[_ ]rate[_ ]limits/i.test(text)) {
      writeLog.push({ operation: "auth-rate-limit-write", table: "customerPasswordSetupRateLimits", rows: [{ source, sql: text }] });
      return { rows: [] };
    }
    writeLog.push({ operation: "raw-write", table: "raw-sql", rows: [{ source, sql: text }] });
    throw new Error("Raw SQL writes are denied by the isolated database adapter.");
  }
  return { rows: [] };
};

const inertValue = new Proxy(function inertValue() {}, {
  get(target, property) {
    if (property === "then") return undefined;
    if (property === "__tableName") return undefined;
    return target;
  },
  apply() { return undefined; },
});

const inertDb = {
  select: (selection) => selectQuery(selection),
  selectDistinct: (selection) => selectQuery(selection),
  insert: (target) => mutation("insert", target),
  update: (target) => mutation("update", target),
  delete: (target) => mutation("delete", target),
  execute: async (query) => executeRawQuery(query, "db.execute"),
  transaction: async (callback) => callback(inertDb),
};
const inertPool = {
  query: async (query) => executeRawQuery(query, "pool.query"),
  connect: async () => ({
    query: async (query) => executeRawQuery(query, "pool.connect.query"),
    release() {},
  }),
  end: async () => undefined,
};
const __values = {
  db: inertDb,
  pool: inertPool,
  closePool: async () => undefined,
  databasePoolStats: () => ({ total: 0, idle: 0, waiting: 0 }),
  getPoolStatus: async () => ({ total: 0, idle: 0, waiting: 0 }),
  isDatabaseQueryObservationRuntimeAllowed: () => false,
  runWithDatabaseQueryObservation: (_captureId, next) => next(),
  databaseQueryObservationHeader: ${JSON.stringify(databaseQueryObservationHeader)},
  assertDestructiveTestRuntimeAllowed: () => {
    if (productionOrDeployment) throw new Error("Destructive test runtime denied by isolated production harness.");
  },
  isProductionOrDeploymentRuntime: () => productionOrDeployment,
  getInertDatabaseSnapshot: () => ({
    mode,
    users: users.map(({ id, email, role }) => ({ id, email, role })),
    salons: salons.map(({ id, slug, name }) => ({ id, slug, name })),
    rowsByTable: Object.fromEntries([
      "users",
      "salons",
      "employees",
      "employeeLocationAssignments",
      "services",
      "employeeServices",
      "salonHours",
      "salonCustomers",
      "productCategories",
      "products",
    ].map((name) => [name, rowsFor(name)])),
    writes: writeLog,
  }),
};
for (const name of ${JSON.stringify([...names])}) {
  if (!__values[name]) {
    __values[name] = name.endsWith("Table") ? table(name) : inertValue;
  }
}
${exports}
`;
}

async function sourceFilesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

async function makeDbPlugin(): Promise<Plugin> {
  const names = databaseImportNames(await sourceFilesUnder(path.join(apiServerRoot, "src")));
  const databaseSources = await sourceFilesUnder(path.join(workspaceRoot, "lib", "db", "src"));
  for (const source of databaseSources) {
    for (const match of source.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(match[1]!);
    }
  }
  const contents = inertDbModuleSource(names);
  return {
    name: "lumera-inert-db",
    setup(pluginBuild: PluginBuild) {
      pluginBuild.onResolve({ filter: /^@workspace\/db(?:\/.*)?$/ }, (args) => ({
        // Every @workspace/db subpath is one virtual module.  Giving each
        // importer a different path would make esbuild bundle duplicate
        // declarations from the same adapter and break ESM linking.
        path: "inert-db",
        namespace: "lumera-inert-db",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "lumera-inert-db" }, () => ({
        contents,
        loader: "js",
        resolveDir: workspaceRoot,
      }));
    },
  };
}

function isolatedDependencyPlugin(): Plugin {
  const blockedPackages = new Set(["sharp", "pdfkit", "bcrypt", "argon2", "fsevents", "@anthropic-ai/sdk"]);
  return {
    name: "lumera-isolated-dependencies",
    setup(pluginBuild: PluginBuild) {
      pluginBuild.onResolve({ filter: /^(sharp|pdfkit|bcrypt|argon2|fsevents|@anthropic-ai\/sdk)$/ }, (args) => ({
        path: args.path,
        namespace: "lumera-isolated-dependency",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "lumera-isolated-dependency" }, (args) => {
        if (!blockedPackages.has(args.path)) return;
        const contents = args.path === "@anthropic-ai/sdk"
          ? `
const blocked = () => {
  throw new Error("Provider/native dependency access is blocked by the isolated safety harness.");
};
class Anthropic {
  constructor() { blocked(); }
}
export default Anthropic;
export { Anthropic, blocked };
`
          : `
const blocked = () => {
  throw new Error("Provider/native dependency access is blocked by the isolated safety harness.");
};
export default blocked;
export { blocked };
`;
        return {
          contents,
          loader: "js",
        };
      });
    },
  };
}

function workspaceSourcePlugin(): Plugin {
  const entryPoints: Record<string, string> = {
    "@workspace/api-zod": path.join(workspaceRoot, "lib", "api-zod", "src", "index.ts"),
    "@workspace/integrations-anthropic-ai": path.join(
      workspaceRoot,
      "lib",
      "integrations-anthropic-ai",
      "src",
      "index.ts",
    ),
  };
  return {
    name: "lumera-isolated-workspace-sources",
    setup(pluginBuild: PluginBuild) {
      pluginBuild.onResolve({ filter: /^@workspace\/(?:api-zod|integrations-anthropic-ai)$/ }, (args) => ({
        path: entryPoints[args.path]!,
      }));
    },
  };
}

let appBundlePromise: Promise<string> | undefined;
async function appBundle(): Promise<string> {
  if (!appBundlePromise) {
    appBundlePromise = (async () => {
      const temporaryDirectory = await mkdtemp(path.join(apiServerRoot, ".lumera-demo-safety-app-"));
      const outfile = path.join(temporaryDirectory, "server.mjs");
      const dbPlugin = await makeDbPlugin();
      const serverSource = `
import { createServer } from "node:http";
import { db, getInertDatabaseSnapshot, salonsTable } from "@workspace/db";
globalThis.fetch = async () => {
  throw new Error("External provider/network access is blocked by the isolated safety harness.");
};
const { default: app } = await import(${JSON.stringify(appPath)});
const server = createServer(async (request, response) => {
  const pathname = (request.url || "").split("?")[0];
  if (pathname === "/__inert-db-state") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(getInertDatabaseSnapshot()));
    return;
  }
  if (request.method === "POST" && pathname === "/__inert-db-negative-control/orm") {
    await db.insert(salonsTable).values({ id: "negative-control-salon" });
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "POST" && pathname === "/__inert-db-negative-control/raw") {
    try {
      await db.execute("INSERT INTO salons (id) VALUES ('negative-control-salon')");
      response.writeHead(204);
      response.end();
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (request.method === "GET" && pathname === "/__inert-network-control") {
    try {
      await fetch("https://provider.invalid/blocked");
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "network unexpectedly allowed" }));
    } catch (error) {
      response.writeHead(204, { "x-isolated-network": "blocked" });
      response.end();
    }
    return;
  }
  app(request, response);
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write("LUMERA_ISOLATED_READY:" + (typeof address === "object" && address ? address.port : "0") + "\\n");
});
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
`;
      await build({
        stdin: { contents: serverSource, loader: "ts", resolveDir: workspaceRoot },
        bundle: true,
        format: "esm",
        platform: "node",
        packages: "external",
        outfile,
        plugins: [dbPlugin, isolatedDependencyPlugin(), workspaceSourcePlugin()],
        sourcemap: false,
        logLevel: "silent",
      });
      return outfile;
    })();
  }
  return appBundlePromise;
}

let fixtureSpyBundlePromise: Promise<string> | undefined;
async function fixtureSpyBundle(): Promise<string> {
  if (!fixtureSpyBundlePromise) {
    fixtureSpyBundlePromise = (async () => {
      const temporaryDirectory = await mkdtemp(path.join(apiServerRoot, ".lumera-demo-safety-fixture-"));
      const outfile = path.join(temporaryDirectory, "fixture.mjs");
      const dbPlugin = await makeDbPlugin();
      const fixturePlugin = {
        name: "lumera-fixture-spy",
        setup(pluginBuild: PluginBuild) {
          pluginBuild.onResolve({ filter: /development-test-fixtures(?:\\.ts)?$/ }, () => ({
            path: "lumera-fixture-spy",
            namespace: "lumera-fixture-spy",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "lumera-fixture-spy" }, () => ({
            contents: `
export async function initializeDevelopmentTestFixtures() {
  process.stdout.write("LUMERA_FIXTURE_SPY:" + String(process.env.NODE_ENV || "") + "\\n");
}
`,
            loader: "js",
          }));
        },
      };
      await build({
        stdin: {
          contents: `
import { ensureDemoData, initializeDevelopmentTestFixtures } from ${JSON.stringify(path.join(apiServerRoot, "src", "lib", "seed.ts"))};
import { getInertDatabaseSnapshot } from "@workspace/db";
const action = process.env.LUMERA_FIXTURE_ACTION || "ensure";
if (action === "initialize") await initializeDevelopmentTestFixtures();
else await ensureDemoData();
process.stdout.write("LUMERA_FIXTURE_DONE\\n");
process.stdout.write("LUMERA_DB_SNAPSHOT:" + JSON.stringify(getInertDatabaseSnapshot()) + "\\n");
`,
          loader: "ts",
          resolveDir: workspaceRoot,
        },
        bundle: true,
        format: "esm",
        platform: "node",
        packages: "external",
        outfile,
        plugins: [dbPlugin, isolatedDependencyPlugin(), workspaceSourcePlugin(), fixturePlugin],
        sourcemap: false,
        logLevel: "silent",
      });
      return outfile;
    })();
  }
  return fixtureSpyBundlePromise;
}

const SAFE_CHILD_ENV_KEYS = new Set([
  "NODE_ENV",
  "REPLIT_DEPLOYMENT",
  "REPL_DEPLOYMENT",
  "LUMERA_ALLOW_PRODUCTION_DEMO_SEED",
  "LUMERA_INERT_DB_MODE",
  "LUMERA_INERT_DB_VERIFICATION_HASH",
  "LUMERA_FIXTURE_ACTION",
]);

function isolatedChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    LUMERA_BLOCK_EXTERNAL_NETWORK: "1",
  };
  for (const key of SAFE_CHILD_ENV_KEYS) {
    if (environment[key] !== undefined) childEnvironment[key] = environment[key];
  }
  return childEnvironment;
}

async function runChild(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<ChildResult> {
  const env = isolatedChildEnvironment(environment);
  try {
    const result = await execFileAsync(executable, args, { cwd: apiServerRoot, env });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

export async function runSeedFacadeInFreshProcess(
  environment: NodeJS.ProcessEnv,
  action: "ensure" | "initialize" = "ensure",
): Promise<ChildResult> {
  const source = `
import("./src/lib/seed.ts").then(async (seed) => {
  if (${JSON.stringify(action)} === "initialize") {
    await seed.initializeDevelopmentTestFixtures();
  } else {
    await seed.ensureDemoData();
  }
  process.stdout.write("LUMERA_SEED_DONE\\n");
}).catch((error) => {
  process.stderr.write("LUMERA_SEED_ERROR:" + (error instanceof Error ? error.message : String(error)) + "\\n");
  process.exitCode = 2;
});
`;
  return runChild(tsxPath, ["-e", source], environment);
}

export async function runSeedFacadeWithFixtureSpy(
  environment: NodeJS.ProcessEnv,
  action: "ensure" | "initialize" = "ensure",
): Promise<ChildResult> {
  const bundle = await fixtureSpyBundle();
  return runChild(process.execPath, [bundle], { ...environment, LUMERA_FIXTURE_ACTION: action });
}

export type IsolatedHttpServer = {
  baseUrl: string;
  snapshot: () => Promise<IsolatedDbSnapshot>;
  diagnostics: () => string;
  close: () => Promise<void>;
};

export async function startIsolatedHttpServer(
  environment: NodeJS.ProcessEnv = {},
): Promise<IsolatedHttpServer> {
  const bundle = await appBundle();
  const childEnvironment: NodeJS.ProcessEnv = {
    ...isolatedChildEnvironment(environment),
    ...environment,
    NODE_ENV: environment.NODE_ENV ?? "production",
    SESSION_SECRET: "isolated-demo-safety-session-secret",
    LUMERA_INERT_DB_MODE: environment.LUMERA_INERT_DB_MODE ?? "empty",
    LUMERA_BLOCK_EXTERNAL_NETWORK: "1",
  };
  for (const key of Object.keys(childEnvironment)) {
    if (!SAFE_CHILD_ENV_KEYS.has(key) && !["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SESSION_SECRET", "LUMERA_BLOCK_EXTERNAL_NETWORK"].includes(key)) {
      delete childEnvironment[key];
    }
  }
  const child = spawn(process.execPath, [bundle], {
    cwd: apiServerRoot,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";

  const ready = await new Promise<number>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Isolated HTTP server did not start. Output: ${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      diagnostics += text;
      const match = output.match(/LUMERA_ISOLATED_READY:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      diagnostics += text;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Isolated HTTP server exited (code=${code}, signal=${signal}). Output: ${output}`));
      }
    });
  });
  const baseUrl = `http://127.0.0.1:${ready}`;
  return {
    baseUrl,
    snapshot: async () => {
      const response = await fetch(`${baseUrl}/__inert-db-state`);
      if (!response.ok) throw new Error(`Harness state endpoint returned ${response.status}.`);
      return response.json() as Promise<IsolatedDbSnapshot>;
    },
    diagnostics: () => diagnostics,
    close: () => stopChild(child),
  };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export async function disposeIsolatedHarness(): Promise<void> {
  // Bundles live in disposable, hidden directories beneath the API package so
  // ESM external dependencies resolve through its node_modules.  They are
  // removed after tests so an interrupted suite cannot pollute artifacts.
  for (const prefix of [".lumera-demo-safety-app-", ".lumera-demo-safety-fixture-"]) {
    const entries = await readdir(apiServerRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => rm(path.join(apiServerRoot, entry.name), { recursive: true, force: true })));
  }
}