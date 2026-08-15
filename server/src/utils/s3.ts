import "../polyfills/dom-parser";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { path_join } from "./path";

export function createS3Client(env: Env): S3Client {
  return new S3Client({
    region: env.S3_REGION || "auto",
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    requestHandler: new FetchHttpHandler(),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export function buildS3ObjectUrl(env: Env, key: string): string {
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  const forcePathStyle = env.S3_FORCE_PATH_STYLE === "true";

  if (forcePathStyle) {
    return path_join(endpoint, bucket, key);
  }

  const urlObj = new URL(endpoint);
  return `${urlObj.protocol}//${bucket}.${urlObj.host}/${key}`;
}

export async function putObject(
  client: S3Client,
  env: Env,
  key: string,
  body: Blob | ArrayBuffer | Uint8Array | string,
  contentType?: string
) {
  const response = await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body as string | Uint8Array | Blob,
      ContentType: contentType,
    })
  );

  return response;
}

export async function getObject(client: S3Client, env: Env, key: string): Promise<Response | null> {
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      })
    );

    const headers = new Headers();
    if (response.ContentType) headers.set("Content-Type", response.ContentType);
    if (response.ETag) headers.set("ETag", response.ETag);
    if (response.ContentLength != null) headers.set("Content-Length", String(response.ContentLength));
    if (response.LastModified) headers.set("Last-Modified", response.LastModified.toUTCString());

    return new Response(response.Body as ReadableStream | null, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function headObject(client: S3Client, env: Env, key: string): Promise<Response | null> {
  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      })
    );

    const headers = new Headers();
    if (response.ContentType) headers.set("Content-Type", response.ContentType);
    if (response.ETag) headers.set("ETag", response.ETag);
    if (response.ContentLength != null) headers.set("Content-Length", String(response.ContentLength));
    if (response.LastModified) headers.set("Last-Modified", response.LastModified.toUTCString());

    return new Response(null, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function deleteObject(client: S3Client, env: Env, key: string) {
  return client.send(
    new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    })
  );
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const e = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
    $response?: { statusCode?: number };
  };
  return (
    e.name === "NotFound" ||
    e.name === "NoSuchKey" ||
    e.$metadata?.httpStatusCode === 404 ||
    e.$response?.statusCode === 404
  );
}