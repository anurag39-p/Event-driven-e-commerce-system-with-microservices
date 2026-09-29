const mockSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn(() => ({ emails: { send: mockSend } })),
}));

let formatCurrency;

function loadNotify({ configured = true } = {}) {
  jest.resetModules();
  if (configured) {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.NOTIFICATION_EMAIL_TO = 'me@example.com';
  } else {
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFICATION_EMAIL_TO;
  }
  const mod = require('./notify');
  formatCurrency = mod.formatCurrency;
  return mod;
}

describe('notify.js - failures must propagate so the retry layer sees them', () => {
  beforeEach(() => {
    mockSend.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('resolves when Resend accepts the email', async () => {
    mockSend.mockResolvedValue({ data: { id: 'abc' }, error: null });
    const { sendOrderConfirmedEmail } = loadNotify();
    await expect(sendOrderConfirmedEmail({ orderId: 1, total: '10.00' })).resolves.toBeUndefined();
  });

  test('rejects on a Resend API error such as a 429 rate limit (was silently swallowed before)', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'Too many requests' } });
    const { sendOrderConfirmedEmail } = loadNotify();
    await expect(sendOrderConfirmedEmail({ orderId: 255, total: '33489.00' })).rejects.toThrow(/Too many requests/);
  });

  test('rejects when the send call itself throws (network failure)', async () => {
    mockSend.mockRejectedValue(new Error('ECONNRESET'));
    const { sendOrderCancelledEmail } = loadNotify();
    await expect(sendOrderCancelledEmail({ orderId: 2, reason: 'declined' })).rejects.toThrow('ECONNRESET');
  });

  test('skips quietly, without throwing, when Resend is not configured', async () => {
    const { sendOrderConfirmedEmail } = loadNotify({ configured: false });
    await expect(sendOrderConfirmedEmail({ orderId: 1, total: '10.00' })).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});


describe('formatCurrency - must match the frontend exactly (₹ + en-IN grouping), not $', () => {
  beforeEach(() => loadNotify());

  test.each([
    ['10', '₹10'],
    ['3498.00', '₹3,498'],
    ['99997.00', '₹99,997'],
    ['203490.00', '₹2,03,490'], // Indian digit grouping, not Western (203,490)
  ])('formats %s as %s', (input, expected) => {
    expect(formatCurrency(input)).toBe(expected);
  });

  test('never contains a dollar sign', () => {
    expect(formatCurrency('99997.00')).not.toMatch(/\$/);
  });
});

describe('email content uses formatCurrency, not a hardcoded $', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'abc' }, error: null });
  });

  test('the confirmation email body and log label both use ₹ with en-IN grouping', async () => {
    const { sendOrderConfirmedEmail } = loadNotify();

    await sendOrderConfirmedEmail({ orderId: 261, total: '103493.00' });

    const [{ html }] = mockSend.mock.calls[0];
    expect(html).toContain('₹1,03,493');
    expect(html).not.toMatch(/\$/);
  });
});
