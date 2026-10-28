// Keep historical Railway Stripe returns and authorized test links working.
const params = new URLSearchParams(location.search);
if (['session', 'cancelled', 'test'].some(key => params.has(key))) {
  location.replace('/ejendomsvurdering' + location.search + location.hash);
}
