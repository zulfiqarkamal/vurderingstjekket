import crypto from 'node:crypto';

export class CommerceError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'CommerceError'; this.status = status; }
}
const reject = () => { throw new CommerceError('Bankpakkekøbet kan ikke modregnes. Kontakt os, hvis du allerede har betalt.'); };
const missing = error => error?.code === 'resource_missing' && error?.statusCode !== 401;

// The opaque Checkout ID is a bearer proof: never log it or authorize by email.
// Only call for the annual plan. Stripe owns the single-redemption counter;
// local prechecks cannot guarantee race safety. Test this contract in Stripe test mode.
export async function bankPackageAnnualCredit(stripe, checkoutId) {
  if (typeof checkoutId !== 'string' || !/^cs_(?:test_|live_)?[A-Za-z0-9]{8,200}$/.test(checkoutId)) reject();
  const purchase = await stripe.checkout.sessions.retrieve(checkoutId, { expand: ['payment_intent.latest_charge'] });
  const payment = purchase.payment_intent;
  const charge = payment?.latest_charge;
  if (purchase.id !== checkoutId || purchase.mode !== 'payment' || purchase.status !== 'complete' ||
      purchase.payment_status !== 'paid' || purchase.currency !== 'dkk' || purchase.metadata?.type !== 'bankpakke' ||
      !Number.isSafeInteger(purchase.amount_total) || purchase.amount_total <= 0 ||
      typeof purchase.customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(purchase.customer) ||
      !payment || typeof payment !== 'object' || payment.status !== 'succeeded' || payment.currency !== 'dkk' ||
      !Number.isSafeInteger(payment.amount_received) || payment.amount_received < purchase.amount_total ||
      !charge || typeof charge !== 'object' || charge.paid !== true || charge.refunded !== false ||
      charge.disputed !== false || charge.amount_refunded !== 0) reject();
  const amount = Math.min(purchase.amount_total, 29900);
  const id = 'blr_credit_' + crypto.createHash('sha256').update(checkoutId).digest('hex').slice(0, 32);
  const expected = { id, amount_off: amount, currency: 'dkk', duration: 'once', max_redemptions: 1,
    name: 'Bankpakke modregnet første år', metadata: { bank_checkout_id: checkoutId, purpose: 'bankpakke_annual_credit' } };
  let coupon;
  try { coupon = await stripe.coupons.retrieve(id); }
  catch (error) { if (!missing(error)) throw error; }
  if (!coupon) {
    try { coupon = await stripe.coupons.create(expected, { idempotencyKey: 'bank-credit-' + id }); }
    catch (error) {
      // The stable ID survives idempotency-key expiry and concurrent creators.
      if (error?.code !== 'resource_already_exists') throw error;
      coupon = await stripe.coupons.retrieve(id);
    }
  }
  if (coupon.deleted || coupon.id !== id || coupon.amount_off !== amount || coupon.currency !== 'dkk' ||
      coupon.duration !== 'once' || coupon.max_redemptions !== 1 || coupon.times_redeemed !== 0 ||
      coupon.valid !== true || coupon.metadata?.bank_checkout_id !== checkoutId ||
      coupon.metadata?.purpose !== 'bankpakke_annual_credit') reject();
  return { customer: purchase.customer, discounts: [{ coupon: id }],
    creditAmount: amount, firstYearAmount: 39900 - amount, renewalAmount: 39900,
    bankCheckoutId: checkoutId };
}
