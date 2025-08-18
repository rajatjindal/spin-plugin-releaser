export interface MustacheView {
  TagName: () => string
  Version: () => string
  addURLAndSha: () => (text: string, render: (text2: string) => string) => void
}

export interface Manifest {
  name: string
  description: string
  homepage: string
  version: string
  spinCompatibility: string
  license: string
  packages: Package[]
}

export interface Package {
  os: string
  arch: string
  url: string
  sha256: string
}

export interface ResolvedInputs {
  repo: string
  owner: string
  actor: string
  releaseTagName: string
  version: string
  releaseWebhookURL: string
  indent: number
  templateFile: string
  uploadChecksums: boolean
  uploadPluginManifest: boolean
}

export interface ReleaseRequest {
  tagName: string
  pluginName: string
  pluginRepo: string
  pluginOwner: string
  pluginReleaseActor: string
  processedTemplate: string
}
