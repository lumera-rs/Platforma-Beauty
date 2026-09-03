import { createHash, createHmac } from "node:crypto";

export type StoredObjectResponse = Response;

export interface ObjectStorage {
  signPut(storagePath: string, ttlSeconds: number): Promise<string>;
  signGet(storagePath: string, ttlSeconds: number): Promise<string>;
  delete(storagePath: string): Promise<void>;
  put(storagePath: string, bytes: Buffer, contentType: string): Promise<void>;
  get(storagePath: string): Promise<StoredObjectResponse>;
}

type Fetch = typeof fetch;
type StorageEnvironment = NodeJS.ProcessEnv;

function privateObjectPath(storagePath: string, environment: StorageEnvironment): string {
  if (!storagePath.startsWith("/objects/")) throw new Error("Neispravna putanja objekta.");
  const root = environment.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return `${root.replace(/\/+$/, "")}/${storagePath.slice("/objects/".length)}`;
}

function rawObjectParts(rawPath: string): { bucketName: string; objectName: string } {
  const [, bucketName, ...objectParts] = rawPath.startsWith("/") ? rawPath.split("/") : `/${rawPath}`.split("/");
  return { bucketName: bucketName!, objectName: objectParts.join("/") };
}

export class ReplitObjectStorage implements ObjectStorage {
  constructor(
    private readonly environment: StorageEnvironment = process.env,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  private async sign(storagePath: string, method: "DELETE" | "GET" | "PUT", ttlSeconds: number): Promise<string> {
    const { bucketName, objectName } = rawObjectParts(privateObjectPath(storagePath, this.environment));
    const response = await this.fetchImplementation("http://127.0.0.1:1106/object-storage/signed-object-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`App Storage nije generisao URL (${response.status}).`);
    const data = await response.json() as { signed_url?: string };
    if (!data.signed_url) throw new Error("App Storage nije vratio potpisani URL.");
    return data.signed_url;
  }

  signPut(storagePath: string, ttlSeconds: number): Promise<string> {
    return this.sign(storagePath, "PUT", ttlSeconds);
  }

  signGet(storagePath: string, ttlSeconds: number): Promise<string> {
    return this.sign(storagePath, "GET", ttlSeconds);
  }

  async delete(storagePath: string): Promise<void> {
    const response = await this.fetchImplementation(await this.sign(storagePath, "DELETE", 60), {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`App Storage nije obrisao objekat (${response.status}).`);
    }
  }

  async put(storagePath: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.fetchImplementation(await this.signPut(storagePath, 120), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`App Storage nije sačuvao objekat (${response.status}).`);
  }

  async get(storagePath: string): Promise<Response> {
    return this.fetchImplementation(await this.signGet(storagePath, 60), {
      signal: AbortSignal.timeout(60_000),
    });
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken?: string;
  private readonly forcePathStyle: boolean;

  constructor(
    environment: StorageEnvironment = process.env,
    private readonly fetchImplementation: Fetch = fetch,
  ) {
    const endpoint = environment.S3_ENDPOINT ?? environment.AWS_ENDPOINT_URL_S3;
    const bucket = environment.S3_BUCKET ?? environment.OBJECT_STORAGE_S3_BUCKET;
    const accessKeyId = environment.S3_ACCESS_KEY_ID ?? environment.AWS_ACCESS_KEY_ID;
    const secretAccessKey = environment.S3_SECRET_ACCESS_KEY ?? environment.AWS_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3 skladište zahteva S3_ENDPOINT, S3_BUCKET i pristupne ključeve.");
    }
    this.endpoint = new URL(endpoint);
    this.bucket = bucket;
    this.region = environment.S3_REGION ?? environment.AWS_REGION ?? "us-east-1";
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = environment.S3_SESSION_TOKEN ?? environment.AWS_SESSION_TOKEN;
    this.forcePathStyle = environment.S3_FORCE_PATH_STYLE !== "false";
  }

  private objectKey(storagePath: string): string {
    if (!storagePath.startsWith("/objects/")) throw new Error("Neispravna putanja objekta.");
    return storagePath.slice("/objects/".length);
  }

  private sign(storagePath: string, method: "DELETE" | "GET" | "PUT", ttlSeconds: number): string {
    const now = new Date();
    const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = date.slice(0, 8);
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const host = this.forcePathStyle ? this.endpoint.host : `${this.bucket}.${this.endpoint.host}`;
    const endpointPath = this.endpoint.pathname.replace(/\/+$/, "");
    const objectPath = encodePath(this.objectKey(storagePath));
    const canonicalUri = this.forcePathStyle
      ? `${endpointPath}/${encodeURIComponent(this.bucket)}/${objectPath}`
      : `${endpointPath}/${objectPath}`;
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${scope}`,
      "X-Amz-Date": date,
      "X-Amz-Expires": String(ttlSeconds),
      "X-Amz-SignedHeaders": "host",
    });
    if (this.sessionToken) query.set("X-Amz-Security-Token", this.sessionToken);
    query.sort();
    const canonicalRequest = [
      method,
      canonicalUri,
      query.toString(),
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, day), this.region), "s3"),
      "aws4_request",
    );
    query.set("X-Amz-Signature", createHmac("sha256", signingKey).update(stringToSign).digest("hex"));
    return `${this.endpoint.protocol}//${host}${canonicalUri}?${query.toString()}`;
  }

  async signPut(storagePath: string, ttlSeconds: number): Promise<string> {
    return this.sign(storagePath, "PUT", ttlSeconds);
  }

  async signGet(storagePath: string, ttlSeconds: number): Promise<string> {
    return this.sign(storagePath, "GET", ttlSeconds);
  }

  async delete(storagePath: string): Promise<void> {
    const response = await this.fetchImplementation(this.sign(storagePath, "DELETE", 60), {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 nije obrisao objekat (${response.status}).`);
    }
  }

  async put(storagePath: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.fetchImplementation(await this.signPut(storagePath, 120), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`S3 nije sačuvao objekat (${response.status}).`);
  }

  get(storagePath: string): Promise<Response> {
    return this.fetchImplementation(this.sign(storagePath, "GET", 60), {
      signal: AbortSignal.timeout(60_000),
    });
  }
}

export function createObjectStorage(
  environment: StorageEnvironment = process.env,
  fetchImplementation: Fetch = fetch,
): ObjectStorage {
  const provider = environment.OBJECT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "replit") return new ReplitObjectStorage(environment, fetchImplementation);
  if (provider === "s3") return new S3ObjectStorage(environment, fetchImplementation);
  throw new Error(`Nepodržan OBJECT_STORAGE_PROVIDER: ${provider}`);
}

export function getObjectStorage(): ObjectStorage {
  return createObjectStorage();
}