const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_EMAIL_TO = process.env.NOTIFICATION_EMAIL_TO;
// Resend's shared test sender - works without verifying your own domain.
const FROM_ADDRESS = 'onboarding@resend.dev';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Matches the frontend's formatting exactly (Checkout.jsx, Orders.jsx,
// Cart.jsx, ProductCard.jsx all use `₹${Number(x).toLocaleString('en-IN')}`)
// so a customer never sees a total in one currency symbol on the site and
// another in their inbox for the same order.
function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

async function sendEmail(subject, html, logLabel) {
  if (!resend || !NOTIFICATION_EMAIL_TO) {
    console.log(`[notification-service] (Resend not configured, skipping real send) ${logLabel}`);
    return;
  }

  // Failures are thrown, not swallowed: this runs inside the reliable
  // handler, so a throw triggers the retry queue (and DLQ after max
  // retries). Swallowing them made the handler look successful, so the
  // message was ACKed and the email lost for good - which happened when a
  // backlog drained after an outage and exceeded Resend's 10 req/s limit.
  let result;
  try {
    result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: NOTIFICATION_EMAIL_TO,
      subject,
      html,
    });
  } catch (err) {
    console.error(`[notification-service] Failed to send email "${subject}":`, err.message);
    throw err;
  }

  if (result.error) {
    console.error(`[notification-service] Resend error sending "${subject}":`, result.error.message);
    throw new Error(`Resend error: ${result.error.message}`);
  }

  console.log(`[notification-service] 📧 Email sent (id: ${result.data.id}) — ${logLabel}`);
}

function sendOrderConfirmedEmail(payload) {
  const { orderId, total } = payload;
  const logLabel = `Order #${orderId} confirmed, total ${formatCurrency(total)}`;
  return sendEmail(
    `Order #${orderId} Confirmed`,
    `<p>Your order <strong>#${orderId}</strong> has been confirmed.</p><p>Total charged: <strong>${formatCurrency(total)}</strong></p>`,
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

module.exports = { sendOrderConfirmedEmail, sendOrderCancelledEmail, formatCurrency };