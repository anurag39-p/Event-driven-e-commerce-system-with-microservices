// Mock payment processor. No real payment provider is involved.
//
// Two distinct failure modes are simulated, and they're handled very
// differently by the saga:
//   - A card decline is a normal, valid business outcome. It returns
//     succeeded: false and should NOT be retried - retrying a declined
//     card just declines it again.
//   - A transient failure (e.g. the payment gateway timing out) is a
//     genuine infrastructure hiccup. It's thrown as an Error, which the
//     reliability wrapper catches and retries - the same request might
//     succeed a few seconds later once the "gateway" is responsive again.

const DECLINE_RATE = 0.1;
const TRANSIENT_FAILURE_RATE = 0.1; // separate from DECLINE_RATE, checked first

function processPayment(order) {
  if (Math.random() < TRANSIENT_FAILURE_RATE) {
    throw new Error('Simulated payment gateway timeout');
  }

  const succeeded = Math.random() >= DECLINE_RATE;
  return {
    succeeded,
    reason: succeeded ? null : 'Simulated card decline',
  };
}

module.exports = { processPayment };