import fs from 'node:fs/promises'
import path from 'node:path'
import { load } from 'js-yaml'

const trainingVideosPath = process.env.TRAINING_VIDEOS_FILE ?? path.resolve('data/training-videos.yaml')

export type TrainingVideoEntry = { title: string; url: string }
export type TrainingVideoSubject = { subject: string; english?: TrainingVideoEntry; mandarin?: TrainingVideoEntry }
export type TrainingVideoCatalog = { libraryUrl: string; videos: TrainingVideoSubject[] }

export async function readTrainingVideoCatalog(): Promise<TrainingVideoCatalog> {
  const raw = await fs.readFile(trainingVideosPath, 'utf8')
  const parsed = load(raw) as TrainingVideoCatalog | undefined
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.videos)) {
    throw new Error('INVALID_TRAINING_VIDEOS_YAML')
  }
  return { libraryUrl: parsed.libraryUrl ?? '', videos: parsed.videos }
}
