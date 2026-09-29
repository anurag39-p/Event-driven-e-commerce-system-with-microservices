// Uses the REAL schema on purpose (no jest.mock of ./Reservation). The
// saga tests mock this model entirely, which is how a status the schema
// rejected ('FAILED') went unnoticed: mocked create() never validates.
const Reservation = require('./Reservation');

describe('Reservation schema', () => {
  test.each(['RESERVED', 'RELEASED', 'FAILED'])('accepts status %s', (status) => {
    const doc = new Reservation({ orderId: 1, items: [], status });
    expect(doc.validateSync()).toBeUndefined();
  });

  test('rejects an unknown status', () => {
    const doc = new Reservation({ orderId: 1, items: [], status: 'NOPE' });
    expect(doc.validateSync()).toBeDefined();
  });

  test('a release tombstone (no items) is valid', () => {
    const doc = new Reservation({ orderId: 265, items: [], status: 'RELEASED' });
    expect(doc.validateSync()).toBeUndefined();
  });
});
