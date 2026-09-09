import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getExplicitCFEContactEmailFromConfig, readEmailRecipientConfig, writeEmailRecipientConfig } from './email-service.js'
import { readTrainingVideoCatalog } from './training-videos.js'

const withTempEnv = async <T>(key: string, value: string | undefined, callback: () => Promise<T>): Promise<T> => {
  const originalValue = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value

  try {
    return await callback()
  } finally {
    if (originalValue === undefined) delete process.env[key]
    else process.env[key] = originalValue
  }
}

test('reads a custom email recipient config from disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-recipients-'))
  const configPath = path.join(directory, 'email-recipients.yaml')
  const yamlText = `wifi-8:
  default: default@example.com
  Lenovo Ideapad: lenovo@example.com
`
  await writeFile(configPath, yamlText, 'utf8')

  await withTempEnv('EMAIL_RECIPIENTS_FILE', configPath, async () => {
    const config = await readEmailRecipientConfig()
    assert.equal(config['wifi-8'].default, 'default@example.com')
    assert.equal(config['wifi-8']['Lenovo Ideapad'], 'lenovo@example.com')
  })

  await rm(directory, { recursive: true, force: true })
})

test('writes and normalizes recipient configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-config-'))
  const configPath = path.join(directory, 'email-recipients.yaml')
  const yamlText = `wifi-8:
  default: default@example.com
  Lenovo Ideapad: lenovo@example.com
`

  await withTempEnv('EMAIL_RECIPIENTS_FILE', configPath, async () => {
    const config = await writeEmailRecipientConfig(yamlText)
    assert.equal(config['wifi-8']['Lenovo Ideapad'], 'lenovo@example.com')
    const written = await readFile(configPath, 'utf8')
    assert.match(written, /Lenovo Ideapad: lenovo@example.com/)
  })

  await rm(directory, { recursive: true, force: true })
})

test('prefers exact OEM/ODM routing while only falling back to default when appropriate', () => {
  const config = {
    'wifi-8': {
      default: 'default@example.com',
      'Lenovo Ideapad': 'lenovo@example.com',
    },
    'bt-hdt': {
      default: 'bt-default@example.com',
      HP: 'hp@example.com',
    },
  } as const

  assert.equal(getExplicitCFEContactEmailFromConfig('wifi-8', 'Lenovo Ideapad', 'NA', config), 'lenovo@example.com')
  assert.equal(getExplicitCFEContactEmailFromConfig('wifi-8', 'Acer', undefined, config), null)
  assert.equal(getExplicitCFEContactEmailFromConfig('wifi-8', undefined, undefined, config), null)
  assert.equal(getExplicitCFEContactEmailFromConfig('bt-hdt', 'HP', 'NA', config), 'hp@example.com')
  assert.equal(getExplicitCFEContactEmailFromConfig('bt-hdt', 'Dell', undefined, config), null)
})

test('loads a valid training video catalog from disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-videos-'))
  const videosPath = path.join(directory, 'training-videos.yaml')
  const yamlText = `libraryUrl: https://example.com/library
videos:
  - subject: Sample Topic
    english:
      title: English
      url: https://example.com/video-en
    mandarin:
      title: Mandarin
      url: https://example.com/video-zh
`
  await writeFile(videosPath, yamlText, 'utf8')

  await withTempEnv('TRAINING_VIDEOS_FILE', videosPath, async () => {
    const catalog = await readTrainingVideoCatalog()
    assert.equal(catalog.libraryUrl, 'https://example.com/library')
    assert.equal(catalog.videos[0].subject, 'Sample Topic')
    assert.equal(catalog.videos[0].english?.url, 'https://example.com/video-en')
    assert.equal(catalog.videos[0].mandarin?.title, 'Mandarin')
  })

  await rm(directory, { recursive: true, force: true })
})

test('rejects malformed training video catalog YAML', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-invalid-videos-'))
  const videosPath = path.join(directory, 'training-videos.yaml')
  await writeFile(videosPath, 'videos:\n  - subject: Sample\n    english: [broken', 'utf8')

  await withTempEnv('TRAINING_VIDEOS_FILE', videosPath, async () => {
    await assert.rejects(() => readTrainingVideoCatalog(), /INVALID_TRAINING_VIDEOS_YAML/)
  })

  await rm(directory, { recursive: true, force: true })
})
