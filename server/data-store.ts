import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dump, load } from 'js-yaml'

export type Training = {
  id: string
  title: string
  shortTitle: string
  instructor: string
  accent: string
  mode: 'Live' | 'Video'
}

export type Session = {
  id: string
  trainingId: string
  date: string
  startTime: string
  durationMinutes: number
  status: 'active' | 'cancelled'
}

export type Booking = {
  id: string
  sessionId: string
  oem: string
  odm?: string
  requesterName: string
  requesterEmail: string
  createdAt: string
  cancelledAt?: string
  status: 'confirmed' | 'cancelled'
}

export type SchedulerData = {
  window: { start: string; end: string; durationMinutes: number }
  trainings: Training[]
  sessions: Session[]
  bookings: Booking[]
  version: number
}

type StoredSchedulerData = Omit<SchedulerData, 'version'> & { version?: number }

export class DataStore {
  constructor(
    private readonly filePath: string,
    private readonly backupDirectory = path.join(path.dirname(filePath), 'scheduler-backups'),
  ) {}

  async validate(): Promise<void> {
    const raw = await fs.readFile(this.filePath, 'utf8')
    this.parse(raw)
    await fs.access(path.dirname(this.filePath), constants.W_OK)
  }

  async read(): Promise<SchedulerData> {
    return this.parse(await fs.readFile(this.filePath, 'utf8'))
  }

  async backup(): Promise<string> {
    await fs.mkdir(this.backupDirectory, { recursive: true })
    const stamp = new Date().toISOString().replace(/[.:]/g, '-')
    const backupPath = path.join(this.backupDirectory, `scheduler-${stamp}-${randomUUID()}.yaml`)
    const temporaryPath = `${backupPath}.${randomUUID()}.tmp`
    await fs.copyFile(this.filePath, temporaryPath)
    await fs.rename(temporaryPath, backupPath)
    const entries = await fs.readdir(this.backupDirectory, { withFileTypes: true })
    const backups = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^scheduler-.*\.yaml$/.test(entry.name))
        .map(async (entry) => ({
          path: path.join(this.backupDirectory, entry.name),
          modifiedAt: (await fs.stat(path.join(this.backupDirectory, entry.name))).mtimeMs,
        })),
    )
    backups.sort((left, right) => right.modifiedAt - left.modifiedAt)
    await Promise.all(backups.slice(8).map((backup) => fs.rm(backup.path, { force: true })))
    return backupPath
  }

  async update(mutator: (data: SchedulerData) => void): Promise<SchedulerData> {
    const lockPath = `${this.filePath}.lock`
    const lock = await this.acquireLock(lockPath)
    try {
      const latest = this.parse(await fs.readFile(this.filePath, 'utf8'))
      mutator(latest)
      latest.version += 1
      const tempPath = `${this.filePath}.${randomUUID()}.tmp`
      await fs.writeFile(tempPath, dump(latest, { noRefs: true }), 'utf8')
      await fs.rename(tempPath, this.filePath)
      return latest
    } finally {
      await lock.close()
      await fs.rm(lockPath, { force: true })
    }
  }

  private parse(raw: string): SchedulerData {
    const parsed = load(raw) as StoredSchedulerData
    if (!parsed?.window || !Array.isArray(parsed.trainings) || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.bookings)) {
      throw new Error('INVALID_SCHEDULER_YAML')
    }
    return { ...parsed, version: parsed.version ?? 0 }
  }

  private async acquireLock(lockPath: string): Promise<import('node:fs/promises').FileHandle> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        return await fs.open(lockPath, 'wx')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    throw new Error('DATA_LOCK_TIMEOUT')
  }
}

export const createDataStore = (): DataStore => {
  const filePath = process.env.DATA_FILE
  if (!filePath) throw new Error('DATA_FILE is required')
  return new DataStore(path.resolve(filePath))
}
