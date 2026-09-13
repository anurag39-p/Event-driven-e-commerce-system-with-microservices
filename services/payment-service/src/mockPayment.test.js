const { processPayment } = require('./mockPayment');

describe('processPayment', () => {
  let randomSpy;

  afterEach(() => {
    if (randomSpy) randomSpy.mockRestore();
  });

  test('throws a transient failure error when the first random draw falls under the transient-failure rate (0.1)', () => {
    randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0.05);

    expect(() => processPayment({})).toThrow('Simulated payment gateway timeout');
  });

  test('returns a decline outcome when the draw passes the transient check but falls under the decline rate', () => {
    randomSpy = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.05);

    const result = processPayment({});

    expect(result.succeeded).toBe(false);
    expect(result.reason).toBe('Simulated card decline');
  });

  test('returns a successful outcome when both draws land outside their respective failure ranges', () => {
    randomSpy = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.5);

    const result = processPayment({});

    expect(result.succeeded).toBe(true);
    expect(result.reason).toBeNull();
  });
});