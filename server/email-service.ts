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
    'Lenovo Ideapad': 'zhiqiang.cai@intel.com',
    Honor: 'charles.p.chu@intel.com',
    Samsung: 'kj.fang@intel.com',
    LG: 'kj.fang@intel.com',
    Acer: 'kj.fang@intel.com',
    HP: 'frank.lee@intel.com',
    Dell: 'frank.fc.yang@intel.com',
    Asus: 'brenton.wu@intel.com',
    'MSFT Surface': 'timdaway.lai@intel.com',
    'Lenovo ThinkPad': 'timdaway.lai@intel.com',
    Microsoft: 'zhiqiang.cai@intel.com',
    'NA / Luxshare': 'zhiqiang.cai@intel.com',
    'NA / Huaqin': 'zhiqiang.cai@intel.com',
    'NA / Longcheer': 'zhiqiang.cai@intel.com',
    Dynabook: 'jackx.lee@intel.com',
    VAIO: 'jackx.lee@intel.com',
    NEC: 'jackx.lee@intel.com',
    Fujitsu: 'jackx.lee@intel.com',
    Panasonic: 'jackx.lee@intel.com',
    MSI: 'jackx.lee@intel.com',
    GIGABYTE: 'jackx.lee@intel.com',
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
    'Lenovo ThinkPad': 'matt.chen@intel.com',
    HP: 'steven1.chen@intel.com',
    'MSFT Surface': 'steven1.chen@intel.com',
    Asus: 'yu-wei.chen@intel.com',
    Dell: 'wesley.kuo@intel.com',
    LG: 'wesley.kuo@intel.com',
    MSI: 'wesley.kuo@intel.com',
    Samsung: 'bingyue.sun@intel.com',
    Honor: 'bingyue.sun@intel.com',
    Xiaomi: 'bingyue.sun@intel.com',
    Aistone: 'bingyue.sun@intel.com',
    'PRC CTE': 'bingyue.sun@intel.com',
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
type BookingEmailDetails = {
  bookingId: string
  sessionId: string
  trainingId: string
  trainingTitle: string
  sessionDate: string
  sessionTime: string
  durationMinutes: number
  oem: string
  odm?: string
  trainingFormat?: 'with-video' | 'without-video'
  requesterName: string
  requesterEmail: string
  createdAt: string
  instructorEmail?: string | null
}
type AgendaItem = { text: string; children?: string[] }

const trainingFormatLabels: Record<NonNullable<BookingEmailDetails['trainingFormat']>, string> = {
  'with-video': 'Training with video: Instructor play online video and answer QnA in person',
  'without-video': 'Training without video: Instructor do live training, no video',
}

const courseAgendas: Record<string, { title: string; items: AgendaItem[] }> = {
  'wifi-8': {
    title: 'WiFi 8 Training agenda',
    items: [
      { text: 'Introduction: why Wi-Fi 8 UHR matters' },
      {
        text: 'The Key Pillars of Wi-Fi 8',
        children: [
          'Real-World Performance: higher speed, improved latency, and network capacity',
          'Trusted & Secured: security, privacy, and connection continuity',
          'Power Saving: longer battery life and lower power consumption',
        ],
      },
    ],
  },
  'bt-hdt': {
    title: 'BT HDT Training agenda',
    items: [
      { text: 'Why HDT, and why now - the market forces behind the specification' },
      { text: "What HDT is, and where it fits in Bluetooth's evolution" },
      { text: 'Key characteristics in plain language' },
      { text: 'Application scenarios on a notebook platform' },
      { text: 'Specification status and a realistic view of the timeline' },
      { text: 'What this means for your platform roadmap, and what to plan for now' },
    ],
  },
  'wifi-log': {
    title: 'WiFi Debug Training agenda',
    items: [
      { text: 'How to download and install Wi-Fi Driver' },
      { text: 'How to use WRT2G' },
      { text: 'How to capture DDD logs' },
      { text: 'Installation of OEM tools' },
      { text: 'DRTU basic function' },
      { text: 'CITU basic function' },
      { text: 'NDT basic function' },
      { text: 'Ant tool basic function' },
    ],
  },
  'bt-log': {
    title: 'BT Debug Training agenda',
    items: [
      { text: 'Install/Uninstall Bluetooth Driver' },
      {
        text: 'Log Capture Tool',
        children: ['Ibttrace', 'MSFT Tracing Tool (Microsoft Bluetooth Tracing)', 'Intel Wireless Reporting Tool (WRT)'],
      },
      { text: 'Ibtverify / GPIO Table' },
      { text: 'Intel SSTDebugStudio' },
    ],
  },
}

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
  details: BookingEmailDetails,
  instructorEmail?: string,
): Promise<void> {
  const subject = `Training Scheduler booking confirmed: ${details.trainingTitle}`
  const html = `
    <p>Hi ${escapeHtml(details.requesterName)},</p>
    <p>Your booking for <strong>${escapeHtml(details.trainingTitle)}</strong> has been confirmed for ${escapeHtml(details.sessionDate)} at ${escapeHtml(details.sessionTime)} PT.</p>
    ${bookingDetailsHtml(details)}
    ${agendaHtml(details.trainingId)}
    <p>The corresponding engineering contact has also been notified for this session.</p>
    <p>Best regards,<br>Training Scheduler</p>
  `

  await transporter.sendMail({
    from: smtpFrom,
    to: details.requesterEmail,
    cc: instructorEmail,
    subject,
    html,
  })
}

export function buildBookingNotificationPreview(details: BookingEmailDetails): string {
  return `
    ${bookingDetailsHtml(details)}
    ${agendaHtml(details.trainingId)}
  `
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

function bookingDetailsHtml(details: BookingEmailDetails): string {
  const rows = [
    ['Booking ID', details.bookingId],
    ['Session ID', details.sessionId],
    ['Training ID', details.trainingId],
    ['Training class', details.trainingTitle],
    ['Date', details.sessionDate],
    ['Start time', `${details.sessionTime} PT`],
    ['Duration', `${details.durationMinutes} minutes`],
    ['OEM', details.oem],
    ['ODM', details.odm ?? 'NA'],
    ['Training type', details.trainingFormat ? trainingFormatLabels[details.trainingFormat] : 'Not specified'],
    ['Requester email', details.requesterEmail],
    ['Engineering contact', details.instructorEmail ?? 'Not configured'],
    ['Created at', details.createdAt],
  ]

  return `
    <h3>Booking details</h3>
    <table cellpadding="6" cellspacing="0" style="border-collapse: collapse; border: 1px solid #d9d9d9;">
      <tbody>
        ${rows.map(([label, value]) => `<tr><th align="left" style="border: 1px solid #d9d9d9; background: #f6f6f6;">${escapeHtml(label)}</th><td style="border: 1px solid #d9d9d9;">${escapeHtml(value)}</td></tr>`).join('')}
      </tbody>
    </table>
  `
}

function agendaHtml(trainingId: string): string {
  const agenda = courseAgendas[baseTrainingId(trainingId)]
  if (!agenda) return ''
  return `
    <h3>${escapeHtml(agenda.title)}</h3>
    <ol>
      ${agenda.items.map(agendaItemHtml).join('')}
    </ol>
  `
}

function agendaItemHtml(item: AgendaItem): string {
  const children = item.children?.length ? `<ul>${item.children.map((child) => `<li>${escapeHtml(child)}</li>`).join('')}</ul>` : ''
  return `<li>${escapeHtml(item.text)}${children}</li>`
}

function baseTrainingId(trainingId: string): string {
  if (trainingId.startsWith('wifi-8')) return 'wifi-8'
  if (trainingId.startsWith('bt-hdt')) return 'bt-hdt'
  return trainingId
}
