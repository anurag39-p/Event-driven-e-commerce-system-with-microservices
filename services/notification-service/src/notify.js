const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_EMAIL_TO = process.env.NOTIFICATION_EMAIL_TO;
// Resend's shared test sender - works without verifying your own domain.
const FROM_ADDRESS = 'onboarding@resend.dev';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendEmail(subject, html, logLabel) {
  if (!resend || !NOTIFICATION_EMAIL_TO) {
    console.log(`[notification-service] (Resend not configured, skipping real send) ${logLabel}`);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: NOTIFICATION_EMAIL_TO,
      subject,
      html,
    });

    if (error) {
      console.error(`[notification-service] Resend error sending "${subject}":`, error.message);
      return;
    }

    console.log(`[notification-service] 📧 Email sent (id: ${data.id}) — ${logLabel}`);
  } catch (err) {
    console.error(`[notification-service] Failed to send email "${subject}":`, err.message);
  }
}

function sendOrderConfirmedEmail(payload) {
  const { orderId, total } = payload;
  const logLabel = `Order #${orderId} confirmed, total $${total}`;
  return sendEmail(
    `Order #${orderId} Confirmed`,
    `<p>Your order <strong>#${orderId}</strong> has been confirmed.</p><p>Total charged: <strong>$${total}</strong></p>`,
    logLabel
  );
}

function sendOrderCancelledEmail(payload) {
  const { orderId, reason } = payload;
  const logLabel = `Order #${orderId} cancelled (${reason || 'payment failed'})`;
  return sendEmail(
    `Order #${orderId} Cancelled`,
    `<p>Unfortunately your order <strong>#${orderId}</strong> could not be completed.</p><p>Reason: ${reason || 'payment failed'}</p>`,
    logLabel
  );
}

module.exports = { sendOrderConfirmedEmail, sendOrderCancelledEmail };