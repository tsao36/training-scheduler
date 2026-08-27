import nodemailer from 'nodemailer'

const smtpHost = process.env.SMTP_HOST ?? 'smtpauth.intel.com'
const smtpPort = Number(process.env.SMTP_PORT ?? 587)
const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.SMTP_PASS
const smtpFrom = process.env.SMTP_FROM ?? 'noreply@intel.com'

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  tls: { rejectUnauthorized: false },
})

export async function sendVerificationEmail(
  to: string,
  requesterName: string,
  trainingTitle: string,
  sessionDate: string,
  sessionTime: string,
  verificationLink: string,
  cc?: string,
): Promise<void> {
  const subject = `Confirm your Training Scheduler booking`
  const html = `
    <p>Hi ${escapeHtml(requesterName)},</p>
    <p>Thank you for booking <strong>${escapeHtml(trainingTitle)}</strong> on ${sessionDate} at ${sessionTime} PT.</p>
    <p>To confirm your booking, please click the link below:</p>
    <p><a href="${escapeHtml(verificationLink)}" style="background-color: #0071c5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Confirm Booking</a></p>
    <p>This link will expire in 24 hours.</p>
    <p>If you did not make this booking, please disregard this email.</p>
    <p>Best regards,<br>Training Scheduler</p>
  `
  
  await transporter.sendMail({
    from: smtpFrom,
    to,
    cc: cc ? cc : undefined,
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
