import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import { dump, load } from 'js-yaml'

const smtpHost = process.env.SMTP_HOST ?? 'smtpauth.intel.com'
const smtpPort = Number(process.env.SMTP_PORT ?? 587)
const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.SMTP_PASS
const smtpFrom = process.env.SMTP_FROM ?? 'noreply@intel.com'
const recipientConfigPath = process.env.EMAIL_RECIPIENTS_FILE ?? path.resolve('data/email-recipients.yaml')

const defaultRecipientConfig = {
  'wifi-log': { default: 'hannahx.hung@intel.com' },
  'wifi-8': {
    default: 'kj.fang@intel.com',
    'Lenovo China': 'zhiqiang.cai@intel.com',
    Honor: 'charles.p.chu@intel.com',
    Samsung: 'kj.fang@intel.com',
    LG: 'kj.fang@intel.com',
    'Lenovo Japan': 'timdaway.lai@intel.com',
    HP: 'frank.lee@intel.com',
    Dell: 'frank.fc.yang@intel.com',
    Asus: 'brenton.wu@intel.com',
    'MSFT Surface': 'timdaway.lai@intel.com',
    Microsoft: 'zhiqiang.cai@intel.com',
    'NA / Luxshare': 'zhiqiang.cai@intel.com',
    'NA / Huaqin': 'zhiqiang.cai@intel.com',
    'NA / Longcheer': 'zhiqiang.cai@intel.com',
    Dynabook: 'jackx.lee@intel.com',
    VAIO: 'jackx.lee@intel.com',
    NEC: 'jackx.lee@intel.com',
    Fujitsu: 'jackx.lee@intel.com',
    Panasonic: 'jackx.lee@intel.com',
    'NA / Compal': 'henryx.su@intel.com',
    'NA / Pegatron': 'henryx.su@intel.com',
    'NA / Quanta': 'henryx.su@intel.com',
    'NA / Inventec': 'henryx.su@intel.com',
    'NA / Wistron': 'henryx.su@intel.com',
  },
  'bt-log': { default: 'shih-hsinx.shen@intel.com' },
  'bt-hdt': {
    default: 'brenton.wu@intel.com',
    Acer: 'matt.chen@intel.com',
    'Lenovo Japan': 'matt.chen@intel.com',
    HP: 'steven1.chen@intel.com',
    'MSFT Surface': 'steven1.chen@intel.com',
    Asus: 'yu-wei.chen@intel.com',
    Dell: 'wesley.kuo@intel.com',
    Samsung: 'bingyue.sun@intel.com',
    LG: 'bingyue.sun@intel.com',
    'Lenovo China': 'juan.zou@intel.com',
    Dynabook: 'brenton.wu@intel.com',
    VAIO: 'brenton.wu@intel.com',
    NEC: 'brenton.wu@intel.com',
    Fujitsu: 'brenton.wu@intel.com',
    Panasonic: 'brenton.wu@intel.com',
    'NA / Luxshare': 'bingyue.sun@intel.com',
    'NA / Huaqin': 'bingyue.sun@intel.com',
    'NA / Longcheer': 'bingyue.sun@intel.com',
  },
} as const

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  tls: { rejectUnauthorized: false },
})

export type EmailRecipientConfig = Record<string, Record<string, string>>

export async function readEmailRecipientConfig(): Promise<EmailRecipientConfig> {
  try {
    const raw = await fs.readFile(recipientConfigPath, 'utf8')
    const parsed = load(raw) as Record<string, Record<string, string>> | undefined
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // Fall back to built-in defaults if the file does not exist yet.
  }
  return { ...defaultRecipientConfig }
}

export async function writeEmailRecipientConfig(yamlText: string): Promise<EmailRecipientConfig> {
  const parsed = load(yamlText) as Record<string, Record<string, string>> | undefined
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_EMAIL_RECIPIENTS_YAML')

  const normalized = Object.fromEntries(
    Object.entries(parsed).map(([trainingId, mapping]) => [trainingId, Object.fromEntries(Object.entries(mapping ?? {}))]),
  )

  await fs.mkdir(path.dirname(recipientConfigPath), { recursive: true })
  const temporaryPath = `${recipientConfigPath}.${randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, dump(normalized, { noRefs: true }), 'utf8')
  await fs.rename(temporaryPath, recipientConfigPath)
  return normalized
}

export function getCFEContactEmailFromConfig(trainingId: string, oem: string | undefined, odm: string | undefined, config: EmailRecipientConfig): string | null {
  const configForTraining = config[trainingId] ?? {}
  const exactOdmMatch = oem && odm ? configForTraining[`${oem} / ${odm}`] : undefined
  if (exactOdmMatch) return exactOdmMatch
  const exactMatch = oem ? configForTraining[oem] : undefined
  if (exactMatch) return exactMatch
  return configForTraining.default ?? null
}

export async function getCFEContactEmail(trainingId: string, oem?: string, odm?: string): Promise<string | null> {
  const config = await readEmailRecipientConfig()
  return getCFEContactEmailFromConfig(trainingId, oem, odm, config)
}

export async function getBookingNotificationRecipients(trainingId: string, requesterEmail: string, oem?: string, odm?: string): Promise<string[]> {
  const instructorEmail = await getCFEContactEmail(trainingId, oem, odm)
  return Array.from(new Set([requesterEmail, ...(instructorEmail ? [instructorEmail] : [])]))
}

export async function sendBookingNotificationEmail(
  requesterEmail: string,
  requesterName: string,
  trainingTitle: string,
  sessionDate: string,
  sessionTime: string,
  instructorEmail?: string,
): Promise<void> {
  const subject = `Training Scheduler booking confirmed: ${trainingTitle}`
  const html = `
    <p>Hi ${escapeHtml(requesterName)},</p>
    <p>Your booking for <strong>${escapeHtml(trainingTitle)}</strong> has been confirmed for ${sessionDate} at ${sessionTime} PT.</p>
    <p>The corresponding engineering contact has also been notified for this session.</p>
    <p>Best regards,<br>Training Scheduler</p>
  `

  await transporter.sendMail({
    from: smtpFrom,
    to: requesterEmail,
    cc: instructorEmail,
    subject,
    html,
  })
}

export async function sendBookingCancellationNotificationEmail(
  requesterEmail: string,
  requesterName: string,
  trainingTitle: string,
  sessionDate: string,
  sessionTime: string,
  instructorEmail?: string,
): Promise<void> {
  const subject = `Training Scheduler booking cancelled: ${trainingTitle}`
  const html = `
    <p>Hi ${escapeHtml(requesterName)},</p>
    <p>Your booking for <strong>${escapeHtml(trainingTitle)}</strong> on ${sessionDate} at ${sessionTime} PT has been cancelled.</p>
    <p>The corresponding engineering contact has also been notified.</p>
    <p>Best regards,<br>Training Scheduler</p>
  `

  await transporter.sendMail({
    from: smtpFrom,
    to: requesterEmail,
    cc: instructorEmail,
    subject,
    html,
  })
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char])
}
