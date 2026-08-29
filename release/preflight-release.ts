import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseManifestSchema, type ReleaseManifest } from "@aubos/contracts";

import {
  git,
  readGitFile,
  resolveCommit,
  validateReleaseManifest,
} from "./release-lib.js";

const hindsightImagePattern =
  /^ghcr\.io\/vectorize-io\/hindsight@sha256:[a-f0-9]{64}$/;

const spdxSetArrayKeys = new Set([
  "annotations",
  "artifactOfs",
  "attributionTexts",
  "checksums",
  "creators",
  "documentDescribes",
  "externalDocumentRefs",
  "externalRefs",
  "fileContributors",
  "fileDependencies",
  "files",
  "fileTypes",
  "hasFiles",
  "hasExtractedLicensingInfos",
  "licenseInfoFromFiles",
  "licenseInfoInFiles",
  "licenseInfoInSnippets",
  "packages",
  "packageVerificationCodeExcludedFiles",
  "relationships",
  "ranges",
  "revieweds",
  "seeAlsos",
  "snippets",
  "crossRefs",
]);

export interface OciInspector {
  format(reference: string, template: string): string;
  raw(reference: string): string;
}

export interface ReleasePreflightResult {
  hindsightReference: string;
  manifest: ReleaseManifest;
  releaseCommit: string;
}

function canonicalizeSpdx(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalizeSpdx(entry));
    if (key && spdxSetArrayKeys.has(key)) {
      entries.sort((a, b) =>
        compareCodeUnits(JSON.stringify(a), JSON.stringify(b)),
      );
    }
    return entries;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareCodeUnits(a, b))
      .map(([entryKey, entryValue]) => [
        entryKey,
        canonicalizeSpdx(entryValue, entryKey),
      ]),
  );
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function spdxCreationTime(createdAt: string): string {
  const match = createdAt.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/,
  );
  if (!match) {
    throw new Error(`SPDX creation time must be an immutable UTC timestamp`);
  }
  if (match[2] && /[1-9]/.test(match[2])) {
    throw new Error(
      `SPDX creation time cannot represent nonzero fractional seconds`,
    );
  }
  return `${match[1]}Z`;
}

export function normalizeSpdxDocument(
  document: unknown,
  identity: {
    artifactDigest: string;
    artifactName: string;
    createdAt: string;
    version: string;
  },
): string {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`SPDX document must be an object`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(identity.artifactDigest)) {
    throw new Error(`SPDX artifact digest must be sha256`);
  }
  if (
    !identity.artifactName ||
    basename(identity.artifactName) !== identity.artifactName
  ) {
    throw new Error(`SPDX artifact name must be a basename`);
  }
  const spdxCreatedAt = spdxCreationTime(identity.createdAt);
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      identity.version,
    )
  ) {
    throw new Error(`SPDX release version must be SemVer`);
  }
  const mutable = structuredClone(document) as Record<string, unknown>;
  if (mutable.spdxVersion !== "SPDX-2.3") {
    throw new Error(`SBOM must use SPDX-2.3`);
  }
  if (mutable.SPDXID !== "SPDXRef-DOCUMENT") {
    throw new Error(`SBOM document must use SPDXRef-DOCUMENT`);
  }
  if (mutable.dataLicense !== "CC0-1.0") {
    throw new Error(`SBOM data license must be CC0-1.0`);
  }
  if (mutable.name !== identity.artifactName) {
    throw new Error(`SBOM document name must match the contract artifact`);
  }
  const creationInfo = mutable.creationInfo;
  if (
    !creationInfo ||
    typeof creationInfo !== "object" ||
    Array.isArray(creationInfo)
  ) {
    throw new Error(`SPDX creationInfo must be an object`);
  }
  const creators = (creationInfo as Record<string, unknown>).creators;
  if (
    !Array.isArray(creators) ||
    creators.length === 0 ||
    creators.some((creator) => typeof creator !== "string" || !creator)
  ) {
    throw new Error(`SPDX creationInfo creators must be nonempty strings`);
  }
  const relationships = mutable.relationships;
  if (!Array.isArray(relationships)) {
    throw new Error(`SPDX relationships must be an array`);
  }
  const describes = relationships.filter(
    (relationship) =>
      relationship &&
      typeof relationship === "object" &&
      !Array.isArray(relationship) &&
      (relationship as Record<string, unknown>).relationshipType ===
        "DESCRIBES",
  ) as Array<Record<string, unknown>>;
  if (
    describes.length !== 1 ||
    describes[0]!.spdxElementId !== "SPDXRef-DOCUMENT" ||
    typeof describes[0]!.relatedSpdxElement !== "string"
  ) {
    throw new Error(
      `SPDX document must contain exactly one DESCRIBES relationship`,
    );
  }
  const packages = mutable.packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error(`SPDX packages must be a nonempty array`);
  }
  const describedPackages = packages.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).SPDXID ===
        describes[0]!.relatedSpdxElement,
  ) as Array<Record<string, unknown>>;
  if (
    describedPackages.length !== 1 ||
    describedPackages[0]!.name !== identity.artifactName
  ) {
    throw new Error(
      `SPDX DESCRIBES target must be the exact contract artifact basename`,
    );
  }
  const checksums = describedPackages[0]!.checksums;
  const sha256Checksums = Array.isArray(checksums)
    ? checksums.filter(
        (checksum) =>
          checksum &&
          typeof checksum === "object" &&
          !Array.isArray(checksum) &&
          (checksum as Record<string, unknown>).algorithm === "SHA256",
      )
    : [];
  if (
    sha256Checksums.length !== 1 ||
    (sha256Checksums[0] as Record<string, unknown>).checksumValue !==
      identity.artifactDigest.slice("sha256:".length)
  ) {
    throw new Error(
      `SPDX DESCRIBES target SHA256 must match the contract artifact`,
    );
  }
  (creationInfo as Record<string, unknown>).created = spdxCreatedAt;
  mutable.documentNamespace =
    `https://aubos.dev/releases/v${identity.version}/sbom/` +
    identity.artifactDigest.replace(":", "-");
  return `${JSON.stringify(canonicalizeSpdx(mutable), null, 2)}\n`;
}

export function normalizeSpdxFile(options: {
  artifactPath: string;
  manifestPath: string;
  sbomPath: string;
}): void {
  const manifest = releaseManifestSchema.parse(
    JSON.parse(readFileSync(options.manifestPath, "utf8")),
  );
  const artifactDigest = `sha256:${createHash("sha256")
    .update(readFileSync(options.artifactPath))
    .digest("hex")}`;
  const document = JSON.parse(
    readFileSync(options.sbomPath, "utf8"),
  ) as unknown;
  writeFileSync(
    options.sbomPath,
    normalizeSpdxDocument(document, {
      artifactDigest,
      artifactName: basename(options.artifactPath),
      createdAt: manifest.createdAt,
      version: manifest.version,
    }),
  );
}

const dockerInspector: OciInspector = {
  format(reference, template) {
    return execFileSync(
      "docker",
      ["buildx", "imagetools", "inspect", reference, "--format", template],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  },
  raw(reference) {
    return execFileSync(
      "docker",
      ["buildx", "imagetools", "inspect", reference, "--raw"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  },
};

function parseObject(
  value: string,
  description: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${description} must be a nonempty object`);
  }
  if (Object.keys(parsed).length === 0) {
    throw new Error(`${description} must be a nonempty object`);
  }
  return parsed as Record<string, unknown>;
}

function requireNonemptyString(value: string, description: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${description} must be nonempty`);
  return normalized;
}

function requirePositiveInteger(value: string, description: string): number {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${description} must be a positive integer`);
  }
  return Number(normalized);
}

function parseJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
}

function parseNullableProvenanceBuilder(
  value: string,
  description: string,
): Record<string, unknown> | null {
  const parsed = parseJson(value, description);
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${description} must be an object or null`);
  }
  const builder = parsed as Record<string, unknown>;
  if (!("id" in builder) || typeof builder.id !== "string") {
    throw new Error(`${description} must contain a string id`);
  }
  return builder;
}

function parseNullableString(
  value: string,
  description: string,
): string | null {
  const parsed = parseJson(value, description);
  if (parsed === null || typeof parsed === "string") return parsed;
  throw new Error(`${description} must be a string or null`);
}

function requireSupportedProvenance(
  inspector: OciInspector,
  reference: string,
  description: string,
): void {
  const legacyBuilder = parseNullableProvenanceBuilder(
    inspector.format(
      reference,
      "{{with .Provenance.SLSA.builder}}{{json .}}{{else}}null{{end}}",
    ),
    `${description} SLSA v0.2 builder`,
  );
  const legacyBuildType = parseNullableString(
    inspector.format(
      reference,
      "{{with .Provenance.SLSA.buildType}}{{json .}}{{else}}null{{end}}",
    ),
    `${description} SLSA v0.2 build type`,
  );
  const v1Builder = parseNullableProvenanceBuilder(
    inspector.format(
      reference,
      "{{with .Provenance.SLSA.runDetails}}{{with .builder}}{{json .}}{{else}}null{{end}}{{else}}null{{end}}",
    ),
    `${description} SLSA v1 builder`,
  );
  const v1BuildType = parseNullableString(
    inspector.format(
      reference,
      "{{with .Provenance.SLSA.buildDefinition}}{{with .buildType}}{{json .}}{{else}}null{{end}}{{else}}null{{end}}",
    ),
    `${description} SLSA v1 build type`,
  );

  const hasLegacy = legacyBuilder !== null || legacyBuildType !== null;
  const hasV1 = v1Builder !== null || v1BuildType !== null;
  if (
    hasLegacy &&
    !hasV1 &&
    legacyBuilder !== null &&
    legacyBuildType === "https://mobyproject.org/buildkit@v1"
  ) {
    return;
  }
  if (
    hasV1 &&
    !hasLegacy &&
    v1Builder !== null &&
    v1BuildType ===
      "https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md"
  ) {
    return;
  }
  throw new Error(
    `${description} must contain exactly one complete recognized BuildKit SLSA v0.2 or v1 predicate`,
  );
}

function requireSpdxCreationInfo(
  value: string,
  description: string,
): Record<string, unknown> {
  const creationInfo = parseObject(value, description);
  if (
    typeof creationInfo.created !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      creationInfo.created,
    )
  ) {
    throw new Error(`${description} must contain a UTC created timestamp`);
  }
  if (
    !Array.isArray(creationInfo.creators) ||
    creationInfo.creators.length === 0 ||
    creationInfo.creators.some(
      (creator) => typeof creator !== "string" || !creator.trim(),
    )
  ) {
    throw new Error(`${description} must contain nonempty string creators`);
  }
  return creationInfo;
}

export function parseHindsightImageReference(toml: string): string {
  let section = "";
  const references: string[] = [];
  for (const line of toml.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    if (section !== "build") continue;
    const imageMatch = line.match(/^\s*image\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
    if (imageMatch) references.push(imageMatch[1]!);
  }

  if (references.length !== 1) {
    throw new Error(
      `Hindsight Fly contract must declare exactly one [build] image`,
    );
  }
  const reference = references[0]!;
  if (!hindsightImagePattern.test(reference)) {
    throw new Error(
      `Hindsight image must use ghcr.io/vectorize-io/hindsight pinned by sha256 digest`,
    );
  }
  return reference;
}

export function parseCliHindsightImageReference(source: string): string {
  const references = [
    ...source.matchAll(/\bconst\s+HINDSIGHT_IMAGE\s*=\s*"([^"]+)"\s*;/g),
  ].map((match) => match[1]!);
  if (references.length !== 1) {
    throw new Error(`AubOS CLI must declare exactly one HINDSIGHT_IMAGE`);
  }
  const reference = references[0]!;
  if (!hindsightImagePattern.test(reference)) {
    throw new Error(
      `AubOS CLI HINDSIGHT_IMAGE must use ghcr.io/vectorize-io/hindsight pinned by sha256 digest`,
    );
  }
  return reference;
}

export function requireHindsightPlatforms(rawManifest: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    throw new Error(`Hindsight OCI manifest is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Hindsight OCI reference must resolve to an image index`);
  }
  const manifests = (parsed as { manifests?: unknown }).manifests;
  if (!Array.isArray(manifests)) {
    throw new Error(`Hindsight OCI reference must resolve to an image index`);
  }

  const platforms = new Set(
    manifests.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return [];
      const platform = (entry as { platform?: unknown }).platform;
      if (
        !platform ||
        typeof platform !== "object" ||
        Array.isArray(platform)
      ) {
        return [];
      }
      const { os, architecture } = platform as {
        os?: unknown;
        architecture?: unknown;
      };
      return typeof os === "string" && typeof architecture === "string"
        ? [`${os}/${architecture}`]
        : [];
    }),
  );
  for (const required of ["linux/amd64", "linux/arm64"]) {
    if (!platforms.has(required)) {
      throw new Error(`Hindsight OCI image index is missing ${required}`);
    }
  }
}

export function inferReleaseVersion(
  repositoryRoot: string,
  releaseCommit: string,
): string | undefined {
  const commit = resolveCommit(repositoryRoot, releaseCommit);
  const changedPaths = String(
    git(repositoryRoot, [
      "diff-tree",
      "-m",
      "--no-commit-id",
      "--name-only",
      "-r",
      commit,
    ]),
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const manifestPaths = [
    ...new Set(
      changedPaths.filter((path) =>
        /^release\/manifests\/[^/]+\.json$/.test(path),
      ),
    ),
  ];
  if (manifestPaths.length === 0) return undefined;
  if (manifestPaths.length !== 1) {
    throw new Error(
      `Release commit must change exactly one release manifest; found ${manifestPaths.join(", ")}`,
    );
  }
  return basename(manifestPaths[0]!, ".json");
}

export function runReleasePreflight(options: {
  repositoryRoot: string;
  releaseCommit: string;
  repositoryOwner: string;
  version: string;
  inspector?: OciInspector;
}): ReleasePreflightResult {
  const releaseCommit = resolveCommit(
    options.repositoryRoot,
    options.releaseCommit,
  );
  const inferredVersion = inferReleaseVersion(
    options.repositoryRoot,
    releaseCommit,
  );
  if (inferredVersion !== options.version) {
    throw new Error(
      `Release commit manifest version mismatch: expected ${options.version}, found ${String(inferredVersion)}`,
    );
  }

  const manifestPath = join(
    options.repositoryRoot,
    "release",
    "manifests",
    `${options.version}.json`,
  );
  if (!existsSync(manifestPath)) {
    throw new Error(`Release manifest not found: ${manifestPath}`);
  }
  const manifest = validateReleaseManifest({
    repositoryRoot: options.repositoryRoot,
    manifestPath,
    expectedRepositoryOwner: options.repositoryOwner,
    releaseCommit,
  });
  if (manifest.status !== "released") {
    throw new Error(`Release ${manifest.version} is still a candidate`);
  }
  spdxCreationTime(manifest.createdAt);

  const inspector = options.inspector ?? dockerInspector;
  for (const [name, image] of Object.entries(manifest.images).sort(([a], [b]) =>
    compareCodeUnits(a, b),
  )) {
    const labels = parseObject(
      inspector.format(image.reference, "{{json .Image.Config.Labels}}"),
      `Image ${name} labels`,
    );
    if (labels["org.opencontainers.image.revision"] !== manifest.sourceCommit) {
      throw new Error(
        `Image ${name} revision label does not match sourceCommit ${manifest.sourceCommit}`,
      );
    }
    requireSupportedProvenance(
      inspector,
      image.reference,
      `Image ${name} provenance`,
    );
    const spdxVersion = requireNonemptyString(
      inspector.format(image.reference, "{{.SBOM.SPDX.spdxVersion}}"),
      `Image ${name} SBOM SPDX version`,
    );
    if (spdxVersion !== "SPDX-2.3") {
      throw new Error(`Image ${name} SBOM must use SPDX-2.3`);
    }
    const sbomDocumentId = requireNonemptyString(
      inspector.format(image.reference, "{{.SBOM.SPDX.SPDXID}}"),
      `Image ${name} SBOM document ID`,
    );
    if (sbomDocumentId !== "SPDXRef-DOCUMENT") {
      throw new Error(`Image ${name} SBOM must use SPDXRef-DOCUMENT`);
    }
    const sbomDataLicense = requireNonemptyString(
      inspector.format(image.reference, "{{.SBOM.SPDX.dataLicense}}"),
      `Image ${name} SBOM data license`,
    );
    if (sbomDataLicense !== "CC0-1.0") {
      throw new Error(`Image ${name} SBOM must use CC0-1.0`);
    }
    requireSpdxCreationInfo(
      inspector.format(image.reference, "{{json .SBOM.SPDX.creationInfo}}"),
      `Image ${name} SBOM creation info`,
    );
    requirePositiveInteger(
      inspector.format(image.reference, "{{len .SBOM.SPDX.packages}}"),
      `Image ${name} SBOM package count`,
    );
  }

  const hindsightContract = readGitFile(
    options.repositoryRoot,
    manifest.sourceCommit,
    "deploy/fly/runtime/hindsight.fly.toml",
  ).toString("utf8");
  const hindsightReference = parseHindsightImageReference(hindsightContract);
  const cliHindsightReference = parseCliHindsightImageReference(
    readGitFile(
      options.repositoryRoot,
      manifest.sourceCommit,
      "packages/cli/src/index.ts",
    ).toString("utf8"),
  );
  if (cliHindsightReference !== hindsightReference) {
    throw new Error(
      `Hindsight Fly contract and AubOS CLI HINDSIGHT_IMAGE must match exactly`,
    );
  }
  requireHindsightPlatforms(inspector.raw(hindsightReference));

  return { hindsightReference, manifest, releaseCommit };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--normalize-sbom")) {
    const artifactPath = readOption(args, "--artifact");
    const manifestPath = readOption(args, "--manifest");
    const sbomPath = readOption(args, "--sbom");
    if (!artifactPath) throw new Error(`--artifact is required`);
    if (!manifestPath) throw new Error(`--manifest is required`);
    if (!sbomPath) throw new Error(`--sbom is required`);
    normalizeSpdxFile({
      artifactPath: resolve(artifactPath),
      manifestPath: resolve(manifestPath),
      sbomPath: resolve(sbomPath),
    });
    process.stdout.write(`normalized ${sbomPath}\n`);
    return;
  }
  const repositoryRoot = resolve(
    readOption(args, "--repository-root") ??
      resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const repositoryOwner = readOption(args, "--repository-owner");
  const releaseCommit = readOption(args, "--release-commit");
  let version = readOption(args, "--version");
  const ifPresent = args.includes("--if-present");
  if (!repositoryOwner) throw new Error(`--repository-owner is required`);
  if (!releaseCommit) throw new Error(`--release-commit is required`);
  if (!version) {
    if (!ifPresent)
      throw new Error(`--version is required without --if-present`);
    version = inferReleaseVersion(repositoryRoot, releaseCommit);
    if (!version) {
      process.stdout.write(`no release manifest in ${releaseCommit}\n`);
      return;
    }
  }

  const result = runReleasePreflight({
    repositoryRoot,
    repositoryOwner,
    releaseCommit,
    version,
  });
  process.stdout.write(
    `preflight valid ${result.manifest.version} ${result.releaseCommit} ${result.hindsightReference}\n`,
  );
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) main();
