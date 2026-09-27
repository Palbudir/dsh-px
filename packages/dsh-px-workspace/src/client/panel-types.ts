import type { Message, Artifact } from '../model'
export interface Content {
  messages: Message[]
  nextBefore: number | null
  artifacts: Artifact[]
  artifactTotal: number
  nextArtifactBefore: string | null
}
